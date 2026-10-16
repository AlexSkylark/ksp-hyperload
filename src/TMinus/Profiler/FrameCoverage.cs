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
        }

        private static readonly List<Interval> Top = new List<Interval>(64);
        private static long _frameStart;
        private static long _total;

        public static void Add(long startTicks, long endTicks)
        {
            if (!Recorder.IsMainThread || endTicks <= startTicks)
                return;

            while (Top.Count > 0 && Top[Top.Count - 1].Start >= startTicks)
            {
                _total -= Top[Top.Count - 1].Counted;
                Top.RemoveAt(Top.Count - 1);
            }

            var from = Math.Max(startTicks, _frameStart);
            if (Top.Count > 0)
                from = Math.Max(from, Top[Top.Count - 1].End);
            var counted = Math.Max(0, endTicks - from);
            Top.Add(new Interval { Start = startTicks, End = endTicks, Counted = counted });
            _total += counted;
        }

        /// <summary>Ticks covered since the last call, which starts a new frame at <paramref name="nowTicks"/>.</summary>
        public static long NextFrame(long nowTicks)
        {
            var covered = _total;
            Top.Clear();
            _total = 0;
            _frameStart = nowTicks;
            return covered;
        }
    }
}
