using System;
using HarmonyLib;

namespace TMinus.Profiler.Hooks
{
    /// <summary>
    /// Per-part compile cost from <c>PartLoader.ParsePart</c>: the synchronous
    /// work for one part (model, modules, icon). Stock <c>CompileParts</c> and
    /// KSPCF's FastLoader both call it. Drag cubes are generated after it and
    /// are not included.
    /// <para>
    /// Two aggregates: by mod (first folder under GameData, all mods written)
    /// and by part (the 50 slowest).
    /// </para>
    /// </summary>
    internal sealed class PartParseHook : IProfilerHook
    {
        private static readonly TimingAggregate ByMod = new TimingAggregate("part.parse.byMod");
        private static readonly TimingAggregate ByPart = new TimingAggregate("part.parse.byPart", topN: 50);

        public string Id => "part.parse";
        public string Group => "startupHooks";

        public void Apply(Harmony harmony)
        {
            var method = AccessTools.Method(typeof(PartLoader), "ParsePart")
                ?? throw new MissingMethodException("PartLoader.ParsePart");

            harmony.Patch(method,
                prefix: HookRegistry.Prefix(typeof(PartParseHook), nameof(Prefix)),
                postfix: HookRegistry.Postfix(typeof(PartParseHook), nameof(Postfix)));
        }

        private static void Prefix(out long __state) => __state = ProfilerClock.Now();

        // Parameter name must match PartLoader.ParsePart(urlConfig, node).
        private static void Postfix(long __state, UrlDir.UrlConfig urlConfig)
        {
            var end = ProfilerClock.Now();
            try
            {
                var url = urlConfig?.url ?? "(unknown)";
                var slash = url.IndexOf('/');
                ByMod.Add(slash < 0 ? url : url.Substring(0, slash), __state, end);
                ByPart.Add(url, __state, end);
            }
            catch (Exception)
            {
                // Never break the game's method.
            }
        }
    }
}
