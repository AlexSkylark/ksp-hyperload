using System;
using UnityProfiler = UnityEngine.Profiling.Profiler;

namespace TMinus.Profiler
{
    internal enum EventKind
    {
        /// <summary>Something with a start and an end.</summary>
        Span,
        /// <summary>A point in time.</summary>
        Mark,
        /// <summary>A named number (count, size, max...).</summary>
        Counter,
        /// <summary>A <see cref="MemorySnapshot"/> taken at a point in time.</summary>
        Memory,
        /// <summary>Count / total / max of many calls (see <see cref="TimingAggregate"/>).</summary>
        Aggregate,
    }

    /// <summary>
    /// One measurement. A struct so recording doesn't allocate; names should be
    /// string constants or strings computed once per key.
    /// </summary>
    internal struct ProfilerEvent
    {
        public EventKind Kind;
        public string Name;
        /// <summary>Optional qualifier, e.g. the loader or scene the event refers to.</summary>
        public string Detail;
        public long StartTicks;
        /// <summary>Spans only.</summary>
        public long EndTicks;
        /// <summary>Counters: the value. Aggregates: total ticks.</summary>
        public double Value;
        /// <summary>Aggregates only.</summary>
        public long Count;
        /// <summary>Aggregates only: longest single call, in ticks.</summary>
        public long MaxTicks;
        /// <summary>Spans only: start or end comes from frame polling or an estimate, not a hook.</summary>
        public bool Approximate;
        /// <summary>Spans only: garbage collections during the span, or -1 when not counted.</summary>
        public int Collections;
        public bool MainThread;
        /// <summary>Memory events only.</summary>
        public MemorySnapshot Memory;
    }

    internal struct MemorySnapshot
    {
        /// <summary>
        /// GC runs so far. KSP's Mono uses a non-generational GC (Boehm): every
        /// generation reports the same count, so only one is recorded.
        /// </summary>
        public int Collections;
        public long MonoUsedBytes;
        public long MonoHeapBytes;
        /// <summary>Native memory Unity has allocated.</summary>
        public long UnityAllocatedBytes;

        /// <summary>Main thread only (Unity's Profiler API).</summary>
        public static MemorySnapshot Capture()
        {
            return new MemorySnapshot
            {
                Collections = GC.CollectionCount(0),
                MonoUsedBytes = UnityProfiler.GetMonoUsedSizeLong(),
                MonoHeapBytes = UnityProfiler.GetMonoHeapSizeLong(),
                UnityAllocatedBytes = UnityProfiler.GetTotalAllocatedMemoryLong(),
            };
        }
    }
}
