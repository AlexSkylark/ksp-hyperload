using System;
using System.Collections.Generic;

namespace TMinus.Profiler
{
    /// <summary>
    /// How much of the current frame ran inside timed hooks, so a long frame can
    /// carry its unattributed rest (the residual: mods' own Unity messages,
    /// coroutines, engine work). Main thread only; calls from other threads are
    /// ignored.
    /// <para>
    /// Hooks report each call when it ends. On one thread a call ends after every
    /// call nested in it, so a call that started at or before the last reported
    /// one contains it: the reported calls form a stack of disjoint top-level
    /// intervals, and their union is kept as a running total. Only synchronous
    /// calls may report here; spans across frames (coroutines, transitions) must
    /// not.
    /// </para>
    /// </summary>
    internal static class FrameCoverage
    {
        private struct Interval
        {
            public long Start;
            public long End;
            /// <summary>Ticks this interval adds to the total, beyond the ones before it.</summary>
            public long Counted;
            /// <summary>Set for calls that move to <see cref="Enclosed"/> when a later call contains them.</summary>
            public TimingAggregate Source;
            public TimingAggregate Enclosed;
            public string Key;
            /// <summary>The ticks <see cref="Source"/> recorded for the call.</summary>
            public long Recorded;
        }

        private static readonly List<Interval> Top = new List<Interval>(64);
        private static long _frameStart;
        private static long _total;

        public static void Add(long startTicks, long endTicks) => Add(startTicks, endTicks, null, null, null);

        /// <summary>
        /// A call that gives way to other timed calls (coroutine steps, see
        /// <see cref="TimingAggregate.Add(string, long, long, TimingAggregate)"/>): returns
        /// the ticks of the timed calls it contains, and if a later reported call that
        /// does not give way contains it, it moves from <paramref name="source"/> to
        /// <paramref name="enclosed"/> under <paramref name="key"/>, with the ticks it
        /// recorded (its own: the call less what it contains).
        /// </summary>
        public static long Add(long startTicks, long endTicks, TimingAggregate source, TimingAggregate enclosed, string key)
        {
            if (!Recorder.IsMainThread || endTicks <= startTicks)
                return 0;

            long contained = 0;
            while (Top.Count > 0 && Top[Top.Count - 1].Start >= startTicks)
            {
                var inner = Top[Top.Count - 1];
                _total -= inner.Counted;
                contained += inner.Counted;
                Top.RemoveAt(Top.Count - 1);
                // A call that gives way keeps nothing of what it contains, so what it contains stays where it is.
                if (source == null)
                    inner.Source?.MoveTo(inner.Enclosed, inner.Key, inner.Recorded);
            }

            var from = Math.Max(startTicks, _frameStart);
            if (Top.Count > 0)
                from = Math.Max(from, Top[Top.Count - 1].End);
            var counted = Math.Max(0, endTicks - from);
            Top.Add(new Interval { Start = startTicks, End = endTicks, Counted = counted, Source = source, Enclosed = enclosed, Key = key, Recorded = endTicks - startTicks - contained });
            _total += counted;
            return contained;
        }

        /// <summary>A stretch of a frame inside timed hooks: top-level calls with holes of at most <see cref="MergeMs"/> between them.</summary>
        public struct CoveredRun
        {
            public long Start;
            public long End;
            /// <summary>Ticks inside hooks, at most End - Start (the holes are not covered).</summary>
            public long Covered;
        }

        /// <summary>
        /// Calls closer than this form one run. Far below the analyzer's smallest
        /// log gap (0.5 s), so a hole cannot hide a silence it counts, and long
        /// enough that back-to-back calls with a little glue between them stay one run.
        /// </summary>
        private const double MergeMs = 1;

        /// <summary>
        /// Ticks covered since the last call, which starts a new frame at <paramref name="nowTicks"/>.
        /// When <paramref name="runs"/> is given, the frame's covered runs with at least
        /// <paramref name="minCoveredTicks"/> inside hooks are added to it, in time order.
        /// </summary>
        public static long NextFrame(long nowTicks, List<CoveredRun> runs = null, long minCoveredTicks = 0)
        {
            var covered = _total;
            if (runs != null)
                CollectRuns(runs, minCoveredTicks);
            Top.Clear();
            _total = 0;
            _frameStart = nowTicks;
            return covered;
        }

        private static void CollectRuns(List<CoveredRun> runs, long minCoveredTicks)
        {
            var mergeTicks = ProfilerClock.TicksFromMs(MergeMs);
            var open = false;
            var run = default(CoveredRun);
            foreach (var i in Top)
            {
                if (i.Counted <= 0)
                    continue;
                var start = Math.Max(i.Start, _frameStart);
                if (open && start - run.End <= mergeTicks)
                {
                    run.End = i.End;
                    run.Covered += i.Counted;
                    continue;
                }
                if (open && run.Covered >= minCoveredTicks)
                    runs.Add(run);
                run = new CoveredRun { Start = start, End = i.End, Covered = i.Counted };
                open = true;
            }
            if (open && run.Covered >= minCoveredTicks)
                runs.Add(run);
        }
    }
}
