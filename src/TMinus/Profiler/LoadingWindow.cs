namespace TMinus.Profiler
{
    /// <summary>
    /// Whether the game is loading: the Countdown (from T-Minus' start to the main
    /// menu's checkpoint) or a Hold (from a <c>HighLogic.LoadScene</c> request to that
    /// transition's "ready" checkpoint). Hooks on code that runs every frame for the
    /// whole session (Unity messages) record only while it is open, so their
    /// aggregates cover loading time only. Main thread only.
    /// </summary>
    internal static class LoadingWindow
    {
        public static bool IsOpen { get; private set; } = true;

        /// <summary>A transition was requested.</summary>
        public static void Open() => IsOpen = true;

        /// <summary>The Countdown or a Hold ended. Call before its checkpoint.</summary>
        public static void Close() => IsOpen = false;
    }
}
