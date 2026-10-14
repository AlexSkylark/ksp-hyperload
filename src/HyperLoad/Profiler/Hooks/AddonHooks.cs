using System;
using HarmonyLib;

namespace HyperLoad.Profiler.Hooks
{
    /// <summary>
    /// Per-addon creation cost. <c>AddonLoader.StartAddon</c> is the single place
    /// where KSP creates each <c>[KSPAddon]</c>: it makes a GameObject and adds
    /// the addon component, which runs its <c>Awake</c> (and <c>OnEnable</c>)
    /// immediately. So timing that call gives Awake cost per addon type and
    /// assembly. <c>Start</c> runs later, in the next frame, and is not
    /// included.
    /// <para>
    /// <c>StartAddon</c> is also called for every addon that does not belong to
    /// the scene and returns at once; those calls are near zero and end up in
    /// the "(other)" line of the aggregate.
    /// </para>
    /// <para>
    /// <c>AddonLoader.StartAddons</c> (all addons of one scene, plus the
    /// reflection scan over every assembly) is recorded as one span per scene.
    /// </para>
    /// </summary>
    internal sealed class AddonHooks : IProfilerHook
    {
        /// <summary>Awake cost per addon, written at each scene checkpoint.</summary>
        private static readonly TimingAggregate AddonAwake = new TimingAggregate("addon.awake", minTotalMs: 0.05);

        public string Id => "addon.awake";
        public string Group => "addonHooks";

        public void Apply(Harmony harmony)
        {
            var startAddons = AccessTools.Method(typeof(AddonLoader), "StartAddons", new[] { typeof(KSPAddon.Startup) })
                ?? throw new MissingMethodException("AddonLoader.StartAddons(KSPAddon.Startup)");
            var startAddon = AccessTools.Method(typeof(AddonLoader), "StartAddon")
                ?? throw new MissingMethodException("AddonLoader.StartAddon");

            harmony.Patch(startAddons,
                prefix: HookRegistry.Prefix(typeof(AddonHooks), nameof(Prefix)),
                postfix: HookRegistry.Postfix(typeof(AddonHooks), nameof(StartAddonsPostfix)));
            harmony.Patch(startAddon,
                prefix: HookRegistry.Prefix(typeof(AddonHooks), nameof(Prefix)),
                postfix: HookRegistry.Postfix(typeof(AddonHooks), nameof(StartAddonPostfix)));
        }

        private static void Prefix(out long __state) => __state = ProfilerClock.Now();

        private static void StartAddonsPostfix(long __state, KSPAddon.Startup level)
        {
            var end = ProfilerClock.Now();
            try
            {
                Recorder.Span("addons.startAll", __state, end, level.ToString());
            }
            catch (Exception)
            {
                // Never break the game's method.
            }
        }

        // Parameter names must match AddonLoader.StartAddon(asm, type, addon, level).
        private static void StartAddonPostfix(long __state, AssemblyLoader.LoadedAssembly asm, Type type)
        {
            var end = ProfilerClock.Now();
            try
            {
                AddonAwake.Add($"{asm?.name}/{type?.FullName}", __state, end);
                AddonStartHooks.OnAddonCreated(type);
            }
            catch (Exception)
            {
                // Never break the game's method.
            }
        }
    }
}
