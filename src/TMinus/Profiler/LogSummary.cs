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
    /// </summary>
    internal sealed class LogSummary
    {
        public const int Format = 2;

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
            public readonly string Name;
            public readonly string Label;
            public readonly string Unit;
            public readonly Dictionary<string, Totals> ByKey = new Dictionary<string, Totals>();

            public Family(string name, string label, string unit)
            {
                Name = name;
                Label = label;
                Unit = unit;
            }
        }

        private readonly List<KeyValuePair<string, ProfilerEvent>> _longFrames = new List<KeyValuePair<string, ProfilerEvent>>();
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
        };
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
            var family = _families.FirstOrDefault(f => f.Name == e.Name);
            if (family == null || e.Detail == null)
                return;
            // The aggregate's own "(other N keys)" line joins ours.
            var key = e.Detail.StartsWith("(other") ? "(other)" : e.Detail;
            if (!family.ByKey.TryGetValue(key, out var totals))
                family.ByKey.Add(key, totals = new Totals());
            totals.Count += e.Count;
            totals.Ms += ProfilerClock.DurationMs(0, (long)e.Value);
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
                lines.Add($"Summary: long frame {frame.Key} at {Seconds(ProfilerClock.ToMsSinceProcessStart(frame.Value.StartTicks), "0.000")} s, {Seconds(ms, "0.000")} s{gc}");
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

            foreach (var p in _addonGrowth.OrderByDescending(p => p.Value).Take(TopN))
                lines.Add($"Summary: addon memory {p.Key} +{Megabytes(p.Value)} MB");

            if (_readyMemory.TryGetValue(transitionLabel, out var memory))
            {
                lines.Add($"Summary: memory managed {Megabytes(memory.MonoUsedBytes)} MB, heap {Megabytes(memory.MonoHeapBytes)} MB, unity {Megabytes(memory.UnityAllocatedBytes)} MB, {memory.Collections - _previousCollections} GC");
                _previousCollections = memory.Collections;
            }

            lines.Add("Summary: end" + (totals.Count > 0 ? " | " + string.Join(", ", totals) : ""));
            _longFrames.Clear();
            _transitions.Clear();
            _overlayMs.Clear();
            _readyMemory.Clear();
            _addonGrowth.Clear();
            _bufferedMs = 0;
            _bufferedSteps = 0;

            // One Debug.Log per line keeps every line timestamped and greppable.
            foreach (var line in lines)
                Debug.Log("[TMinus] " + line);
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

        private static string Megabytes(double bytes) => (bytes / Mb).ToString("0", CultureInfo.InvariantCulture);

        private static string Count(long n, string unit) => $"{n} {unit}{(n == 1 ? "" : "s")}";
    }
}
