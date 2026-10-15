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
    /// </summary>
    internal sealed class LogSummary
    {
        public const int Format = 1;

        /// <summary>Frames at least this long are listed (the analyzer's long-frame threshold).</summary>
        private const double LongFrameMs = 2000;
        /// <summary>Entries listed per family; the rest go into one "(other ...)" line.</summary>
        private const int TopN = 10;

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
        private readonly Family[] _families =
        {
            new Family("addon.awake", "addon Awake", "call"),
            new Family("addon.start", "addon Start", "call"),
            new Family("part.parse.byMod", "parts", "part"),
        };

        /// <summary>Takes what the summary needs from a batch of drained events.</summary>
        public void Collect(List<ProfilerEvent> events)
        {
            foreach (var e in events)
            {
                if (e.Kind == EventKind.Span && e.Name == "frame.long" && ProfilerClock.DurationMs(e.StartTicks, e.EndTicks) >= LongFrameMs)
                    _longFrames.Add(new KeyValuePair<string, ProfilerEvent>(e.Detail, e));
                else if (e.Kind == EventKind.Span && e.Name == "scene.transition" && e.Detail != null)
                    _transitions[e.Detail] = e;
                else if (e.Kind == EventKind.Aggregate)
                {
                    var family = _families.FirstOrDefault(f => f.Name == e.Name);
                    if (family == null || e.Detail == null)
                        continue;
                    // The aggregate's own "(other N keys)" line joins ours.
                    var key = e.Detail.StartsWith("(other") ? "(other)" : e.Detail;
                    Totals totals;
                    if (!family.ByKey.TryGetValue(key, out totals))
                        family.ByKey.Add(key, totals = new Totals());
                    totals.Count += e.Count;
                    totals.Ms += ProfilerClock.DurationMs(0, (long)e.Value);
                }
            }
        }

        /// <summary>Writes the block for a completed transition, then starts the next one.</summary>
        public void Write(string transitionLabel)
        {
            ProfilerEvent transition;
            if (!_transitions.TryGetValue(transitionLabel, out transition))
                return;

            var lines = new List<string>();
            var ready = Seconds(ProfilerClock.ToMsSinceProcessStart(transition.EndTicks), "0.000");
            var now = Seconds(ProfilerClock.ToMsSinceProcessStart(ProfilerClock.Now()), "0.000");
            var what = transitionLabel == "LOADING->MAINMENU"
                ? "Countdown"
                : $"Hold {transitionLabel} {Seconds(ProfilerClock.DurationMs(transition.StartTicks, transition.EndTicks), "0.00")} s,";
            lines.Add($"Summary (format {Format}): {what} ready at {ready} s, this line at {now} s after process start");

            var framesMs = 0.0;
            foreach (var frame in _longFrames.OrderBy(f => f.Value.StartTicks))
            {
                var ms = ProfilerClock.DurationMs(frame.Value.StartTicks, frame.Value.EndTicks);
                framesMs += ms;
                lines.Add($"Summary: long frame {frame.Key} at {Seconds(ProfilerClock.ToMsSinceProcessStart(frame.Value.StartTicks), "0.000")} s, {Seconds(ms, "0.000")} s");
            }

            var totals = new List<string>();
            if (_longFrames.Count > 0)
                totals.Add($"{_longFrames.Count} long frame{(_longFrames.Count == 1 ? "" : "s")} {Seconds(framesMs, "0.0")} s");

            foreach (var family in _families.Where(f => f.ByKey.Count > 0))
            {
                var ranked = family.ByKey.Where(p => p.Key != "(other)").OrderByDescending(p => p.Value.Ms).ToList();
                var other = new Totals();
                var otherKeys = 0;
                Totals cut;
                if (family.ByKey.TryGetValue("(other)", out cut))
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

                foreach (var p in ranked.Take(TopN))
                    lines.Add($"Summary: {family.Label} {p.Key} {Ms(p.Value.Ms)} ms, {Count(p.Value.Count, family.Unit)}");
                if (other.Count > 0)
                    lines.Add($"Summary: {family.Label} (other{(otherKeys > 0 ? $" {otherKeys}" : "")}) {Ms(other.Ms)} ms, {Count(other.Count, family.Unit)}");

                totals.Add($"{family.Label} {Seconds(family.ByKey.Values.Sum(t => t.Ms), "0.0")} s");
                family.ByKey.Clear();
            }

            lines.Add("Summary: end" + (totals.Count > 0 ? " | " + string.Join(", ", totals) : ""));
            _longFrames.Clear();
            _transitions.Clear();

            // One Debug.Log per line keeps every line timestamped and greppable.
            foreach (var line in lines)
                Debug.Log("[TMinus] " + line);
        }

        private static string Seconds(double ms, string format) => (ms / 1000.0).ToString(format, CultureInfo.InvariantCulture);

        private static string Ms(double ms) => ms.ToString("0", CultureInfo.InvariantCulture);

        private static string Count(long n, string unit) => $"{n} {unit}{(n == 1 ? "" : "s")}";
    }
}
