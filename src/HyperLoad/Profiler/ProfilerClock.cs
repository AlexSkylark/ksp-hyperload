using System;
using System.Diagnostics;
using UnityEngine;

namespace HyperLoad.Profiler
{
    /// <summary>
    /// Single time base for every measurement: raw <see cref="Stopwatch"/> ticks
    /// while recording (cheap, thread-safe), converted to milliseconds since
    /// process start only when written out.
    /// </summary>
    internal static class ProfilerClock
    {
        private static readonly double MsPerTick = 1000.0 / Stopwatch.Frequency;

        private static double _anchorMsSinceProcessStart;

        /// <summary>Ticks when the profiler started (our Instantly addon's Awake).</summary>
        public static long AnchorTicks { get; private set; }

        /// <summary>Process start expressed in Stopwatch ticks (may be negative).</summary>
        public static long ProcessStartTicks { get; private set; }

        public static DateTime ProcessStartUtc { get; private set; }
        public static DateTime AnchorUtc { get; private set; }
        public static float AnchorRealtimeSinceStartup { get; private set; }

        /// <summary>False when the OS refused the process start time and we fell back to Unity's clock.</summary>
        public static bool ProcessStartKnown { get; private set; }

        public static void Initialize()
        {
            AnchorTicks = Stopwatch.GetTimestamp();
            AnchorUtc = DateTime.UtcNow;
            AnchorRealtimeSinceStartup = Time.realtimeSinceStartup;

            try
            {
                using (var process = Process.GetCurrentProcess())
                    ProcessStartUtc = process.StartTime.ToUniversalTime();
                ProcessStartKnown = true;
            }
            catch (Exception)
            {
                // Unity's clock starts slightly after the process does, but it is the best fallback.
                ProcessStartUtc = AnchorUtc - TimeSpan.FromSeconds(AnchorRealtimeSinceStartup);
                ProcessStartKnown = false;
            }

            _anchorMsSinceProcessStart = (AnchorUtc - ProcessStartUtc).TotalMilliseconds;
            ProcessStartTicks = AnchorTicks - (long)(_anchorMsSinceProcessStart / MsPerTick);
        }

        public static long Now() => Stopwatch.GetTimestamp();

        public static double ToMsSinceProcessStart(long ticks) =>
            _anchorMsSinceProcessStart + (ticks - AnchorTicks) * MsPerTick;

        public static double DurationMs(long startTicks, long endTicks) => (endTicks - startTicks) * MsPerTick;
    }
}
