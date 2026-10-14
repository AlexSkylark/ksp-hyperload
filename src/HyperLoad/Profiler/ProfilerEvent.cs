using System;
using UnityProfiler = UnityEngine.Profiling.Profiler;

namespace HyperLoad.Profiler
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
        /// <summary>Counters only.</summary>
        public double Value;
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
