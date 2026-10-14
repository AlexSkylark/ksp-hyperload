using System.Collections.Generic;
using System.Threading;

namespace HyperLoad.Profiler
{
    /// <summary>
    /// In-memory event buffer. Thread-safe: ModuleManager and KSPCF run work on
    /// background threads, so hooks may record from any thread. Nothing is
    /// written to disk here; <see cref="ProfilerHost"/> drains the buffer at
    /// checkpoints.
    /// </summary>
    internal static class Recorder
    {
        private static readonly object Sync = new object();
        private static List<ProfilerEvent> _pending = new List<ProfilerEvent>(4096);
        private static int _mainThreadId;

        public static void Initialize() => _mainThreadId = Thread.CurrentThread.ManagedThreadId;

        public static bool IsMainThread => Thread.CurrentThread.ManagedThreadId == _mainThreadId;

        public static void Span(string name, long startTicks, long endTicks, string detail = null, bool approximate = false) =>
            Add(new ProfilerEvent { Kind = EventKind.Span, Name = name, Detail = detail, StartTicks = startTicks, EndTicks = endTicks, Approximate = approximate });

        public static void Mark(string name, string detail = null) =>
            Add(new ProfilerEvent { Kind = EventKind.Mark, Name = name, Detail = detail, StartTicks = ProfilerClock.Now() });

        public static void Counter(string name, double value, string detail = null) =>
            Add(new ProfilerEvent { Kind = EventKind.Counter, Name = name, Detail = detail, StartTicks = ProfilerClock.Now(), Value = value });

        public static void Aggregate(string name, string key, long count, long totalTicks, long maxTicks) =>
            Add(new ProfilerEvent { Kind = EventKind.Aggregate, Name = name, Detail = key, StartTicks = ProfilerClock.Now(), Count = count, Value = totalTicks, MaxTicks = maxTicks });

        /// <summary>Main thread only.</summary>
        public static void Memory(string name, string detail = null) =>
            Add(new ProfilerEvent { Kind = EventKind.Memory, Name = name, Detail = detail, StartTicks = ProfilerClock.Now(), Memory = MemorySnapshot.Capture() });

        /// <summary>
        /// Returns every pending event and continues recording into <paramref name="spare"/>
        /// (cleared first), so the two lists can be swapped back and forth without allocating.
        /// </summary>
        public static List<ProfilerEvent> Drain(List<ProfilerEvent> spare)
        {
            spare.Clear();
            lock (Sync)
            {
                var taken = _pending;
                _pending = spare;
                return taken;
            }
        }

        private static void Add(ProfilerEvent e)
        {
            e.MainThread = IsMainThread;
            lock (Sync)
                _pending.Add(e);
        }
    }
}
