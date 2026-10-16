using System.Collections.Generic;
using System.Linq;

namespace TMinus.Profiler
{
    /// <summary>
    /// Folds many timed calls into count / total / max per key, for hooks that
    /// fire thousands of times (one record per part or per config file would be
    /// too much output and too much overhead). Thread-safe.
    /// <para>
    /// Aggregates are written and reset at phase checkpoints
    /// (<see cref="EmitAll"/>), so each record covers the calls since the
    /// previous checkpoint.
    /// </para>
    /// </summary>
    internal sealed class TimingAggregate
    {
        private sealed class Stats
        {
            public long Count;
            public long TotalTicks;
            public long MaxTicks;
        }

        private static readonly List<TimingAggregate> All = new List<TimingAggregate>();

        private readonly object _sync = new object();
        private readonly Dictionary<string, Stats> _byKey = new Dictionary<string, Stats>();
        private readonly string _name;
        private readonly int _topN;
        private readonly long _minTotalTicks;

        /// <param name="name">Record name in the output.</param>
        /// <param name="topN">Only write the N keys with the highest total; 0 writes all keys.</param>
        /// <param name="minTotalMs">Keys whose total is below this go into the "(other)" line.</param>
        public TimingAggregate(string name, int topN = 0, double minTotalMs = 0)
        {
            _name = name;
            _topN = topN;
            _minTotalTicks = (long)(minTotalMs / 1000.0 * System.Diagnostics.Stopwatch.Frequency);
            lock (All)
                All.Add(this);
        }

        /// <param name="coversFrame">
        /// False for spans across frames (coroutines): they must not count as
        /// measured time in <see cref="FrameCoverage"/>.
        /// </param>
        public void Add(string key, long startTicks, long endTicks, bool coversFrame = true)
        {
            if (coversFrame)
                FrameCoverage.Add(startTicks, endTicks);
            var ticks = endTicks - startTicks;
            lock (_sync)
            {
                if (!_byKey.TryGetValue(key, out var stats))
                    _byKey.Add(key, stats = new Stats());
                stats.Count++;
                stats.TotalTicks += ticks;
                if (ticks > stats.MaxTicks)
                    stats.MaxTicks = ticks;
            }
        }

        /// <summary>
        /// Like <see cref="Add"/>, for synchronous calls that give way to every other
        /// timed call, so totals never add any time twice (coroutine steps):
        /// <list type="bullet">
        /// <item>only the call's own time is recorded: timed calls inside it, steps
        /// included, keep theirs;</item>
        /// <item>when a timed call that encloses this one ends later in the frame (and
        /// does not give way itself), this call moves to <paramref name="enclosed"/>
        /// under the same key: its time is already inside the other call's.</item>
        /// </list>
        /// </summary>
        public void Add(string key, long startTicks, long endTicks, TimingAggregate enclosed)
        {
            // Off the main thread FrameCoverage sees nothing: the whole call is its own.
            var contained = FrameCoverage.Add(startTicks, endTicks, this, enclosed, key);
            Add(key, 0, endTicks - startTicks - contained, coversFrame: false);
        }

        /// <summary>
        /// Moves one call of <paramref name="key"/> to <paramref name="target"/>. The
        /// key's max is left as it was. A call already written by a checkpoint stays
        /// here (rare: a checkpoint inside the enclosing call).
        /// </summary>
        internal void MoveTo(TimingAggregate target, string key, long ticks)
        {
            lock (_sync)
            {
                if (!_byKey.TryGetValue(key, out var stats) || stats.Count == 0 || stats.TotalTicks < ticks)
                    return;
                stats.Count--;
                stats.TotalTicks -= ticks;
                if (stats.Count == 0)
                    _byKey.Remove(key);
            }
            target.Add(key, 0, ticks, coversFrame: false);
        }

        /// <summary>Records every aggregate that has data, then resets them.</summary>
        public static void EmitAll()
        {
            lock (All)
            {
                foreach (var aggregate in All)
                    aggregate.Emit();
            }
        }

        private void Emit()
        {
            List<KeyValuePair<string, Stats>> entries;
            lock (_sync)
            {
                if (_byKey.Count == 0)
                    return;
                entries = _byKey.ToList();
                _byKey.Clear();
            }

            var ordered = entries.OrderByDescending(e => e.Value.TotalTicks).ToList();
            var keep = ordered.Count;
            if (_topN > 0)
                keep = System.Math.Min(keep, _topN);
            while (keep > 0 && ordered[keep - 1].Value.TotalTicks < _minTotalTicks)
                keep--;

            for (var i = 0; i < keep; i++)
                Recorder.Aggregate(_name, ordered[i].Key, ordered[i].Value.Count, ordered[i].Value.TotalTicks, ordered[i].Value.MaxTicks);

            // Keep the totals honest: what is cut off is summed into one "(other)" line.
            if (keep < ordered.Count)
            {
                var other = new Stats();
                for (var i = keep; i < ordered.Count; i++)
                {
                    other.Count += ordered[i].Value.Count;
                    other.TotalTicks += ordered[i].Value.TotalTicks;
                    other.MaxTicks = System.Math.Max(other.MaxTicks, ordered[i].Value.MaxTicks);
                }
                Recorder.Aggregate(_name, $"(other {ordered.Count - keep} keys)", other.Count, other.TotalTicks, other.MaxTicks);
            }
        }
    }
}
