namespace TMinus.Report
{
    /// <summary>
    /// For the dev route (src/TMinus.Route), which calls it by reflection so it
    /// never depends on this assembly: write the report at the route's end, as a
    /// click would, without opening the browser, so automated runs archive it.
    /// </summary>
    public static class ReportApi
    {
        /// <summary>False when the report button is off, the Countdown is not over, or a report is being written.</summary>
        public static bool Request() => ReportService.Instance?.Request(false) ?? false;

        public static bool Busy => ReportService.Instance?.Busy ?? false;

        /// <summary>The last report written, or null when it failed.</summary>
        public static string LastReport => ReportService.Instance?.LastReport;
    }
}
