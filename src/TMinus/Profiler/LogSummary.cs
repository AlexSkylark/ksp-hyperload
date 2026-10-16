using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using UnityEngine;

namespace TMinus.Profiler
{
    /// <summary>
    /// Writes the profiler's key numbers to KSP.log when the Countdown ends (main
    /// menu ready) and after each Hold, so a player who only shares KSP.log still
    /// shares them. Each block covers the events since the previous block.
    /// <para>
    /// The analyzer parses these lines (tools/analyze/src/core/summary.ts): change
    /// the format only together with it, and bump <see cref="Format"/>.
    /// </para>
    /// <para>
    /// Format 2 adds: garbage collections per long frame, ScenarioModules and
    /// terrain starts, the buffered switch's steps and the overlay wait after GUI
    /// ready, memory at the end of each block, large managed growth per addon, and
    /// in the Countdown block the GC mode and KSPCF settings changed by patches.
    /// </para>
    /// <para>
    /// Format 3 adds: the time inside timed hooks per long frame, module time per
    /// type and per assembly (PartModules and VesselModules, all stages summed),
    /// Harmony patching and unpatching per owner, and, with the opt-in per-call
    /// brackets, the methods whose other mods' patches cost most, their owners, the
    /// brackets' calibration and coverage. ScenarioModule keys carry the assembly.
    /// </para>
    /// <para>
    /// Format 4 adds: per long frame, its longest covered runs (start+length:time
    /// inside hooks, in seconds), so the analyzer can leave measured work out of
    /// the log's silences.
    /// </para>
    /// </summary>
    internal sealed class LogSummary
    {
        public const int Format = 4;

        /// <summary>
        /// Covered runs listed per long frame, the longest ones. Keeps the line short;
        /// the analyzer bounds what the left-out runs cover by the frame's covered total.
        /// </summary>
        private const int RunsPerFrame = 20;

        /// <summary>Frames at least this long are listed (the analyzer's long-frame threshold).</summary>
        private const double LongFrameMs = 2000;
        /// <summary>Entries listed per family; the rest go into one "(other ...)" line.</summary>
        private const int TopN = 10;

        private const double Mb = 1024.0 * 1024.0;

        private sealed class Totals
        {
            public long Count;
            public double Ms;
        }

        private sealed class Family
        {
            public readonly string[] Names;
            public readonly string Label;
            public readonly string Unit;
            /// <summary>The summary's key for an aggregate's key (null: the same).</summary>
            public readonly Func<string, string> KeyOf;
            public readonly Dictionary<string, Totals> ByKey = new Dictionary<string, Totals>();

            public Family(string name, string label, string unit) : this(new[] { name }, label, unit, null)
            {
            }

            public Family(string[] names, string label, string unit, Func<string, string> keyOf)
            {
                Names = names;
                Label = label;
                Unit = unit;
                KeyOf = keyOf;
            }
        }

        private sealed class PatchCall
        {
            public long Calls;
            public double PatchesMs;
            public double BodyMs;
        }

        /// <summary>Every stage at which KSP runs a module type's code; keys are <c>&lt;assembly&gt;/&lt;type&gt;</c>.</summary>
        private static readonly string[] ModuleFamilies =
        {
            "module.load", "module.awake", "module.onStart", "module.onStartFinished",
            "vesselModule.awake", "vesselModule.start", "vesselModule.load",
        };

        private static string AssemblyOfKey(string key)
        {
            var slash = key.IndexOf('/');
            return slash > 0 ? key.Substring(0, slash) : key;
        }

        private readonly List<KeyValuePair<string, ProfilerEvent>> _longFrames = new List<KeyValuePair<string, ProfilerEvent>>();
        private readonly List<ProfilerEvent> _coveredRuns = new List<ProfilerEvent>();
        private readonly Dictionary<string, ProfilerEvent> _transitions = new Dictionary<string, ProfilerEvent>();
        private readonly Dictionary<string, double> _overlayMs = new Dictionary<string, double>();
        private readonly Dictionary<string, MemorySnapshot> _readyMemory = new Dictionary<string, MemorySnapshot>();
        private readonly Dictionary<string, double> _addonGrowth = new Dictionary<string, double>();
        private readonly Family[] _families =
        {
            new Family("addon.awake", "addon Awake", "call"),
            new Family("addon.start", "addon Start", "call"),
            new Family("part.parse.byMod", "parts", "part"),
            new Family("scenario.load", "scenario", "module"),
            new Family("pqs.forceStart", "terrain", "start"),
            new Family(ModuleFamilies, "module", "call", null),
            new Family(ModuleFamilies, "modules", "call", AssemblyOfKey),
            new Family("harmony.patch", "harmony patch", "patch"),
            new Family("harmony.unpatch", "harmony unpatch", "unpatch"),
        };
        private readonly Dictionary<string, PatchCall> _patchCalls = new Dictionary<string, PatchCall>();
        /// <summary>Owners per bracketed method, from its bracket mark; kept for the whole session.</summary>
        private readonly Dictionary<string, string> _patchOwners = new Dictionary<string, string>();
        private double _calibrationPatchesNs = -1;
        private double _calibrationBodyNs = -1;
        private double _bracketed = -1;
        private double _skipped;
        private string _skippedDetail;
        private double _bufferedMs;
        private int _bufferedSteps;
        private int _previousCollections;

        /// <summary>Takes what the summary needs from a batch of drained events.</summary>
        public void Collect(List<ProfilerEvent> events)
        {
            foreach (var e in events)
            {
                switch (e.Kind)
                {
                    case EventKind.Span when e.Name == "frame.long" && ProfilerClock.DurationMs(e.StartTicks, e.EndTicks) >= LongFrameMs:
                        _longFrames.Add(new KeyValuePair<string, ProfilerEvent>(e.Detail, e));
                        break;
                    case EventKind.Span when e.Name == "frame.covered":
                        _coveredRuns.Add(e);
                        break;
                    case EventKind.Span when e.Name == "scene.transition" && e.Detail != null:
                        _transitions[e.Detail] = e;
                        break;
                    case EventKind.Span when e.Name == "scene.bufferedLoad.step":
                        _bufferedMs += ProfilerClock.DurationMs(e.StartTicks, e.EndTicks);
                        _bufferedSteps++;
                        break;
                    case EventKind.Counter when e.Name == "scene.overlayAfterGuiReady" && e.Detail != null:
                        _overlayMs[e.Detail] = e.Value;
                        break;
                    case EventKind.Counter when e.Name == "addon.awake.monoGrowth" && e.Detail != null:
                        _addonGrowth.TryGetValue(e.Detail, out var bytes);
                        _addonGrowth[e.Detail] = bytes + e.Value;
                        break;
                    case EventKind.Mark when e.Name == "harmony.call.bracket" && e.Detail != null:
                        var colon = e.Detail.LastIndexOf(": ", StringComparison.Ordinal);
                        if (colon > 0)
                            _patchOwners[e.Detail.Substring(0, colon)] = e.Detail.Substring(colon + 2);
                        break;
                    case EventKind.Counter when e.Name == "harmony.call.calibration.patches":
                        _calibrationPatchesNs = e.Value;
                        break;
                    case EventKind.Counter when e.Name == "harmony.call.calibration.body":
                        _calibrationBodyNs = e.Value;
                        break;
                    case EventKind.Counter when e.Name == "harmony.call.bracketed":
                        _bracketed = e.Value;
                        break;
                    case EventKind.Counter when e.Name == "harmony.call.skipped":
                        _skipped = e.Value;
                        _skippedDetail = e.Detail;
                        break;
                    case EventKind.Memory when e.Name == "scene.ready" && e.Detail != null:
                        _readyMemory[e.Detail] = e.Memory;
                        break;
                    case EventKind.Aggregate:
                        AddAggregate(e);
                        break;
                }
            }
        }

        private void AddAggregate(ProfilerEvent e)
        {
            if (e.Detail == null)
                return;
            // The aggregate's own "(other N keys)" line joins ours.
            var other = e.Detail.StartsWith("(other");
            var ms = ProfilerClock.DurationMs(0, (long)e.Value);
            if (e.Name == "harmony.call.patches" || e.Name == "harmony.call.body")
            {
                var key = other ? "(other)" : e.Detail;
                if (!_patchCalls.TryGetValue(key, out var call))
                    _patchCalls.Add(key, call = new PatchCall());
                if (e.Name == "harmony.call.patches")
                {
                    call.Calls += e.Count;
                    call.PatchesMs += ms;
                }
                else
                    call.BodyMs += ms;
                return;
            }
            foreach (var family in _families.Where(f => f.Names.Contains(e.Name)))
            {
                var key = other ? "(other)" : family.KeyOf?.Invoke(e.Detail) ?? e.Detail;
                if (!family.ByKey.TryGetValue(key, out var totals))
                    family.ByKey.Add(key, totals = new Totals());
                totals.Count += e.Count;
                totals.Ms += ms;
            }
        }

        /// <summary>Writes the block for a completed transition, then starts the next one.</summary>
        public void Write(string transitionLabel)
        {
            if (!_transitions.TryGetValue(transitionLabel, out var transition))
                return;

            var countdown = transitionLabel == "LOADING->MAINMENU";
            var lines = new List<string>();
            var ready = Seconds(ProfilerClock.ToMsSinceProcessStart(transition.EndTicks), "0.000");
            var now = Seconds(ProfilerClock.ToMsSinceProcessStart(ProfilerClock.Now()), "0.000");
            var duration = Seconds(ProfilerClock.DurationMs(transition.StartTicks, transition.EndTicks), "0.00");
            lines.Add(countdown
                ? $"Summary (format {Format}): Countdown ready at {ready} s (main menu scene {duration} s), this line at {now} s after process start"
                : $"Summary (format {Format}): Hold {transitionLabel} {duration} s, ready at {ready} s, this line at {now} s after process start");

            if (countdown)
                AddInstallLines(lines);

            var framesMs = 0.0;
            foreach (var frame in _longFrames.OrderBy(f => f.Value.StartTicks))
            {
                var ms = ProfilerClock.DurationMs(frame.Value.StartTicks, frame.Value.EndTicks);
                framesMs += ms;
                var gc = frame.Value.Collections >= 0 ? $", {frame.Value.Collections} GC" : "";
                var covered = frame.Value.Value >= 0 ? $", covered {Seconds(frame.Value.Value, "0.000")} s" : "";
                var runs = _coveredRuns
                    .Where(r => r.StartTicks >= frame.Value.StartTicks && r.EndTicks <= frame.Value.EndTicks)
                    .OrderByDescending(r => r.Value)
                    .Take(RunsPerFrame)
                    .OrderBy(r => r.StartTicks)
                    .Select(r => $"{Seconds(ProfilerClock.ToMsSinceProcessStart(r.StartTicks), "0.000")}+{Seconds(ProfilerClock.DurationMs(r.StartTicks, r.EndTicks), "0.000")}:{Seconds(r.Value, "0.000")}")
                    .ToList();
                var runsText = runs.Count > 0 ? ", runs " + string.Join(" ", runs) : "";
                lines.Add($"Summary: long frame {frame.Key} at {Seconds(ProfilerClock.ToMsSinceProcessStart(frame.Value.StartTicks), "0.000")} s, {Seconds(ms, "0.000")} s{gc}{covered}{runsText}");
            }

            if (!countdown && (_bufferedSteps > 0 || _overlayMs.ContainsKey(transitionLabel)))
            {
                _overlayMs.TryGetValue(transitionLabel, out var overlay);
                lines.Add($"Summary: switch buffered steps {Seconds(_bufferedMs, "0.000")} s in {_bufferedSteps}, overlay after GUI ready {Seconds(overlay, "0.000")} s");
            }

            var totals = new List<string>();
            if (_longFrames.Count > 0)
                totals.Add($"{_longFrames.Count} long frame{(_longFrames.Count == 1 ? "" : "s")} {Seconds(framesMs, "0.0")} s");

            foreach (var family in _families.Where(f => f.ByKey.Count > 0))
            {
                AddFamilyLines(family, lines);
                totals.Add($"{family.Label} {Seconds(family.ByKey.Values.Sum(t => t.Ms), "0.0")} s");
                family.ByKey.Clear();
            }

            AddPatchCallLines(lines, totals);

            foreach (var p in _addonGrowth.OrderByDescending(p => p.Value).Take(TopN))
                lines.Add($"Summary: addon memory {p.Key} +{Megabytes(p.Value)} MB");

            if (_readyMemory.TryGetValue(transitionLabel, out var memory))
            {
                lines.Add($"Summary: memory managed {Megabytes(memory.MonoUsedBytes)} MB, heap {Megabytes(memory.MonoHeapBytes)} MB, unity {Megabytes(memory.UnityAllocatedBytes)} MB, {memory.Collections - _previousCollections} GC");
                _previousCollections = memory.Collections;
            }

            lines.Add("Summary: end" + (totals.Count > 0 ? " | " + string.Join(", ", totals) : ""));
            _longFrames.Clear();
            _coveredRuns.Clear();
            _transitions.Clear();
            _overlayMs.Clear();
            _readyMemory.Clear();
            _addonGrowth.Clear();
            _bufferedMs = 0;
            _bufferedSteps = 0;
            _patchCalls.Clear();
            _calibrationPatchesNs = -1;
            _calibrationBodyNs = -1;
            _bracketed = -1;

            // One Debug.Log per line keeps every line timestamped and greppable.
            foreach (var line in lines)
                Debug.Log("[TMinus] " + line);
        }

        /// <summary>The opt-in per-call brackets: the costliest methods by their other mods' patches.</summary>
        private void AddPatchCallLines(List<string> lines, List<string> totals)
        {
            if (_calibrationPatchesNs >= 0)
                lines.Add($"Summary: patch call calibration {Ns(_calibrationPatchesNs)} ns, body {Ns(_calibrationBodyNs)} ns per call");
            if (_bracketed >= 0)
                lines.Add($"Summary: patch calls bracketed {Ms(_bracketed)}, skipped {Ms(_skipped)}{(string.IsNullOrEmpty(_skippedDetail) ? "" : $" ({_skippedDetail})")}");
            if (_patchCalls.Count == 0)
                return;

            var ranked = _patchCalls.Where(p => p.Key != "(other)").OrderByDescending(p => p.Value.PatchesMs).ToList();
            var other = new PatchCall();
            var otherKeys = 0;
            if (_patchCalls.TryGetValue("(other)", out var cut))
                Add(other, cut);
            foreach (var p in ranked.Skip(TopN))
            {
                Add(other, p.Value);
                otherKeys++;
            }
            foreach (var p in ranked.Take(TopN).Where(p => p.Value.PatchesMs >= 0.5))
            {
                var owners = _patchOwners.TryGetValue(p.Key, out var o) && o.Length > 0 ? $", by {o}" : "";
                lines.Add($"Summary: patch call {p.Key} {Ms(p.Value.PatchesMs)} ms, {Count(p.Value.Calls, "call")}, body {Ms(p.Value.BodyMs)} ms{owners}");
            }
            if (other.Calls > 0 && other.PatchesMs >= 0.5)
                lines.Add($"Summary: patch call (other{(otherKeys > 0 ? $" {otherKeys}" : "")}) {Ms(other.PatchesMs)} ms, {Count(other.Calls, "call")}, body {Ms(other.BodyMs)} ms");
            totals.Add($"patch calls {Seconds(_patchCalls.Values.Sum(c => c.PatchesMs), "0.0")} s");

            void Add(PatchCall into, PatchCall from)
            {
                into.Calls += from.Calls;
                into.PatchesMs += from.PatchesMs;
                into.BodyMs += from.BodyMs;
            }
        }

        private static void AddInstallLines(List<string> lines)
        {
            var incremental = RunConditions.GcIncremental();
            lines.Add($"Summary: GC incremental {(incremental.HasValue ? (incremental.Value ? "yes" : "no") : "unknown")}, mode {RunConditions.GcMode() ?? "unknown"}");

            var kspcf = KspcfSettings.Get();
            if (kspcf.Nodes > 1)
                lines.Add($"Summary: KSPCF settings nodes {kspcf.Nodes}");
            foreach (var change in kspcf.Changes)
                lines.Add($"Summary: KSPCF setting {change}");
        }

        private static void AddFamilyLines(Family family, List<string> lines)
        {
            var ranked = family.ByKey.Where(p => p.Key != "(other)").OrderByDescending(p => p.Value.Ms).ToList();
            var other = new Totals();
            var otherKeys = 0;
            if (family.ByKey.TryGetValue("(other)", out var cut))
            {
                other.Count += cut.Count;
                other.Ms += cut.Ms;
            }
            foreach (var p in ranked.Skip(TopN))
            {
                other.Count += p.Value.Count;
                other.Ms += p.Value.Ms;
                otherKeys++;
            }

            // Entries under half a millisecond would print as "0 ms": the closing line's total still counts them.
            foreach (var p in ranked.Take(TopN).Where(p => p.Value.Ms >= 0.5))
                lines.Add($"Summary: {family.Label} {p.Key} {Ms(p.Value.Ms)} ms, {Count(p.Value.Count, family.Unit)}");
            if (other.Count > 0 && other.Ms >= 0.5)
                lines.Add($"Summary: {family.Label} (other{(otherKeys > 0 ? $" {otherKeys}" : "")}) {Ms(other.Ms)} ms, {Count(other.Count, family.Unit)}");
        }

        private static string Seconds(double ms, string format) => (ms / 1000.0).ToString(format, CultureInfo.InvariantCulture);

        private static string Ms(double ms) => ms.ToString("0", CultureInfo.InvariantCulture);

        private static string Ns(double ns) => ns.ToString("0.0", CultureInfo.InvariantCulture);

        private static string Megabytes(double bytes) => (bytes / Mb).ToString("0", CultureInfo.InvariantCulture);

        private static string Count(long n, string unit) => $"{n} {(n == 1 ? unit : unit.EndsWith("ch") ? unit + "es" : unit + "s")}";
    }
}
