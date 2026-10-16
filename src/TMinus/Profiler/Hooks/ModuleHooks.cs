using System;
using System.Collections.Generic;
using HarmonyLib;
using UnityEngine;

namespace TMinus.Profiler.Hooks
{
    /// <summary>
    /// Module dispatch: where KSP runs the code of PartModules and VesselModules,
    /// most of it mods' code (docs/m5-profiler-plan.md, "Module dispatch"). All
    /// targets are stock and non-virtual, so one patch sees every module type.
    /// <list type="bullet">
    /// <item>By module type: <c>PartModule.Load</c> (field load, upgrades,
    /// <c>OnLoad</c>), <c>PartModule.Awake</c> (<c>OnAwake</c>; a type that
    /// declares its own <c>Awake</c> bypasses it), <c>VesselModule.Awake</c>,
    /// <c>Start</c>, <c>Load</c>.</item>
    /// <item>By part name: one part's modules started (<c>Part.ModulesOnStart</c>,
    /// <c>ModulesOnStartFinished</c>, <c>InitializeModules</c>) and one saved part
    /// loaded (<c>ProtoPartSnapshot.Load</c>).</item>
    /// <item>By vessel type: <c>ProtoVessel.Load</c> (the vessel object and its
    /// VesselModules) and <c>Vessel.Load</c> (its parts); slow ones also as spans,
    /// with their part count.</item>
    /// </list>
    /// The levels nest (a vessel load contains its parts' loads, which contain
    /// their modules' Awake and Load) and are recorded separately: self time is
    /// for the analysis. Per-module <c>OnStart</c> and <c>OnStartFinished</c>
    /// come from <see cref="ModuleStartHooks"/>.
    /// </summary>
    internal static class ModuleHooks
    {
        public const string Group = "moduleHooks";

        /// <summary>A vessel whose parts take at least this long to load is also recorded as a span.</summary>
        private const double SlowVesselMs = 100;

        public static IEnumerable<IProfilerHook> Create()
        {
            var partModuleLoad = new TimingAggregate("module.load", minTotalMs: 0.05);
            var partModuleAwake = new TimingAggregate("module.awake", minTotalMs: 0.05);
            var vesselModuleAwake = new TimingAggregate("vesselModule.awake", minTotalMs: 0.05);
            var vesselModuleStart = new TimingAggregate("vesselModule.start", minTotalMs: 0.05);
            var vesselModuleLoad = new TimingAggregate("vesselModule.load", minTotalMs: 0.05);
            var partInitialize = new TimingAggregate("part.initializeModules", topN: 50, minTotalMs: 0.05);
            var partLoad = new TimingAggregate("part.load", topN: 50, minTotalMs: 0.05);
            var vesselProtoLoad = new TimingAggregate("vessel.protoLoad");
            var vesselLoad = new TimingAggregate("vessel.load");

            return new IProfilerHook[]
            {
                TimedMethodHook.ByInstance("module.load", Group,
                    () => AccessTools.Method(typeof(PartModule), nameof(PartModule.Load), new[] { typeof(ConfigNode) }),
                    partModuleLoad, TimedMethodHook.TypeKey),
                TimedMethodHook.ByInstance("module.awake", Group,
                    () => AccessTools.Method(typeof(PartModule), nameof(PartModule.Awake), Type.EmptyTypes),
                    partModuleAwake, TimedMethodHook.TypeKey),
                TimedMethodHook.ByInstance("vesselModule.awake", Group,
                    () => AccessTools.Method(typeof(VesselModule), "Awake", Type.EmptyTypes),
                    vesselModuleAwake, TimedMethodHook.TypeKey),
                TimedMethodHook.ByInstance("vesselModule.start", Group,
                    () => AccessTools.Method(typeof(VesselModule), "Start", Type.EmptyTypes),
                    vesselModuleStart, TimedMethodHook.TypeKey),
                TimedMethodHook.ByInstance("vesselModule.load", Group,
                    () => AccessTools.Method(typeof(VesselModule), nameof(VesselModule.Load), new[] { typeof(ConfigNode) }),
                    vesselModuleLoad, TimedMethodHook.TypeKey),

                new ModuleStartHooks(),
                TimedMethodHook.ByInstance("part.initializeModules", Group,
                    () => AccessTools.Method(typeof(Part), nameof(Part.InitializeModules), Type.EmptyTypes),
                    partInitialize, o => PartKey((Part)o)),
                TimedMethodHook.ByInstance("part.load", Group,
                    () => AccessTools.Method(typeof(ProtoPartSnapshot), nameof(ProtoPartSnapshot.Load), new[] { typeof(Vessel), typeof(bool) }),
                    partLoad, o => ((ProtoPartSnapshot)o).partName ?? "(unnamed)"),

                TimedMethodHook.ByInstance("vessel.protoLoad", Group,
                    () => AccessTools.Method(typeof(ProtoVessel), "Load", new[] { typeof(FlightState), typeof(Vessel) }),
                    vesselProtoLoad, o => ((ProtoVessel)o).vesselType.ToString()),
                new TimedMethodHook("vessel.load", Group,
                    () => AccessTools.Method(typeof(Vessel), nameof(Vessel.Load), Type.EmptyTypes),
                    (start, end, instance) =>
                    {
                        if (!(instance is Vessel vessel))
                            return;
                        var type = vessel.vesselType.ToString();
                        vesselLoad.Add(type, start, end);
                        if (ProfilerClock.DurationMs(start, end) >= SlowVesselMs)
                            Recorder.Span("vessel.load.slow", start, end, $"{type}, {vessel.parts?.Count ?? 0} parts");
                    }),
            };
        }

        /// <summary>A part's key: its part name (the config's <c>name</c>), shared by every copy of it.</summary>
        public static string PartKey(Part part) => part.partInfo?.name ?? "(no partInfo)";
    }

    /// <summary>
    /// Per-module <c>OnStart</c> and <c>OnStartFinished</c>, which have no stock
    /// method per module: KSP calls them in loops over a part's modules
    /// (<c>Part.ModulesOnStart</c>, <c>Part.ModulesOnStartFinished</c>). Each
    /// iteration is cut by a marker, a stock call it makes for each module
    /// (docs/m5-profiler-plan.md):
    /// <list type="bullet">
    /// <item><c>ModulesOnStart</c> calls <c>PartModule.ApplyUpgrades(StartState)</c>
    /// first for each module (after <c>SetPartModule</c>, a one-line setter that
    /// Mono inlines, so Harmony never sees it). An iteration lasts until the next
    /// marker or the loop's end, and covers the module's upgrades, <c>OnStart</c>,
    /// staging toggle and mass. <c>ApplyUpgrades</c> is also called outside the
    /// loop (editor, KSPCF), so a marker counts only when its module is the part's
    /// next one. The patch is on the base method: a module that overrides it
    /// without calling base skips its marker, and its time goes to the previous
    /// module.</item>
    /// <item><c>ModulesOnStartFinished</c> calls <c>PartModule.ApplyAdjustersOnStart()</c>
    /// right after each <c>OnStartFinished</c>. An iteration lasts from the
    /// previous marker's end (or the loop's start) to the marker. A module whose
    /// <c>OnStartFinished</c> throws skips its marker: its time goes to the next
    /// module.</item>
    /// </list>
    /// The loops also record their total per part name. Main thread only.
    /// </summary>
    internal sealed class ModuleStartHooks : IProfilerHook
    {
        private sealed class Loop
        {
            public Part Part;
            /// <summary>Index of the module being timed, -1 before the first marker.</summary>
            public int Index;
            public PartModule Module;
            public long Start;
        }

        private static readonly TimingAggregate ModuleOnStart = new TimingAggregate("module.onStart", minTotalMs: 0.05);
        private static readonly TimingAggregate ModuleOnStartFinished = new TimingAggregate("module.onStartFinished", minTotalMs: 0.05);
        private static readonly TimingAggregate PartOnStart = new TimingAggregate("part.modulesOnStart", topN: 50, minTotalMs: 0.05);
        private static readonly TimingAggregate PartOnStartFinished = new TimingAggregate("part.modulesOnStartFinished", topN: 50, minTotalMs: 0.05);

        // Open loops, innermost last: a module's OnStart can start another part.
        private static readonly List<Loop> StartLoops = new List<Loop>();
        private static readonly List<Loop> FinishedLoops = new List<Loop>();
        private static bool _failureLogged;

        public string Id => "module.onStart";
        public string Group => ModuleHooks.Group;

        public void Apply(Harmony harmony)
        {
            var onStart = AccessTools.Method(typeof(Part), nameof(Part.ModulesOnStart), Type.EmptyTypes)
                ?? throw new MissingMethodException("Part.ModulesOnStart()");
            var onStartFinished = AccessTools.Method(typeof(Part), nameof(Part.ModulesOnStartFinished), Type.EmptyTypes)
                ?? throw new MissingMethodException("Part.ModulesOnStartFinished()");
            var applyUpgrades = AccessTools.Method(typeof(PartModule), nameof(PartModule.ApplyUpgrades), new[] { typeof(PartModule.StartState) })
                ?? throw new MissingMethodException("PartModule.ApplyUpgrades(StartState)");
            var applyAdjusters = AccessTools.Method(typeof(PartModule), nameof(PartModule.ApplyAdjustersOnStart), Type.EmptyTypes)
                ?? throw new MissingMethodException("PartModule.ApplyAdjustersOnStart()");

            harmony.Patch(onStart,
                prefix: HookRegistry.Prefix(typeof(ModuleStartHooks), nameof(OnStartPrefix)),
                postfix: HookRegistry.Postfix(typeof(ModuleStartHooks), nameof(OnStartPostfix)));
            harmony.Patch(onStartFinished,
                prefix: HookRegistry.Prefix(typeof(ModuleStartHooks), nameof(OnStartFinishedPrefix)),
                postfix: HookRegistry.Postfix(typeof(ModuleStartHooks), nameof(OnStartFinishedPostfix)));
            harmony.Patch(applyUpgrades, prefix: HookRegistry.Prefix(typeof(ModuleStartHooks), nameof(ApplyUpgradesPrefix)));
            harmony.Patch(applyAdjusters,
                prefix: HookRegistry.Prefix(typeof(ModuleStartHooks), nameof(ApplyAdjustersPrefix)),
                postfix: HookRegistry.Postfix(typeof(ModuleStartHooks), nameof(ApplyAdjustersPostfix)));
        }

        private static void OnStartPrefix(Part __instance, out long __state)
        {
            __state = ProfilerClock.Now();
            Open(StartLoops, __instance, __state);
        }

        private static void OnStartPostfix(long __state, Part __instance)
        {
            var end = ProfilerClock.Now();
            try
            {
                var loop = Close(StartLoops, __instance);
                if (loop?.Module != null)
                    ModuleOnStart.Add(TypeKeys.Of(loop.Module.GetType()), loop.Start, end);
                PartOnStart.Add(ModuleHooks.PartKey(__instance), __state, end);
            }
            catch (Exception e)
            {
                LogFailure(e);
            }
        }

        // The module about to start.
        private static void ApplyUpgradesPrefix(PartModule __instance)
        {
            var p = __instance;
            if (StartLoops.Count == 0 || p == null)
                return;
            var now = ProfilerClock.Now();
            try
            {
                var loop = StartLoops[StartLoops.Count - 1];
                if (!Recorder.IsMainThread || p.part != loop.Part)
                    return;
                var modules = loop.Part.Modules;
                var next = loop.Index + 1;
                if (next >= modules.Count || modules[next] != p)
                    return; // A call outside the loop, not the part's next module.
                if (loop.Module != null)
                    ModuleOnStart.Add(TypeKeys.Of(loop.Module.GetType()), loop.Start, now);
                loop.Index = next;
                loop.Module = p;
                loop.Start = ProfilerClock.Now();
            }
            catch (Exception e)
            {
                LogFailure(e);
            }
        }

        private static void OnStartFinishedPrefix(Part __instance, out long __state)
        {
            __state = ProfilerClock.Now();
            Open(FinishedLoops, __instance, __state);
        }

        private static void OnStartFinishedPostfix(long __state, Part __instance)
        {
            var end = ProfilerClock.Now();
            try
            {
                Close(FinishedLoops, __instance);
                PartOnStartFinished.Add(ModuleHooks.PartKey(__instance), __state, end);
            }
            catch (Exception e)
            {
                LogFailure(e);
            }
        }

        private static void ApplyAdjustersPrefix(PartModule __instance)
        {
            if (FinishedLoops.Count == 0)
                return;
            var now = ProfilerClock.Now();
            try
            {
                var loop = FinishedLoops[FinishedLoops.Count - 1];
                if (Recorder.IsMainThread && __instance.part == loop.Part)
                    ModuleOnStartFinished.Add(TypeKeys.Of(__instance.GetType()), loop.Start, now);
            }
            catch (Exception e)
            {
                LogFailure(e);
            }
        }

        // The next module's OnStartFinished starts after the adjusters.
        private static void ApplyAdjustersPostfix(PartModule __instance)
        {
            if (FinishedLoops.Count == 0)
                return;
            try
            {
                var loop = FinishedLoops[FinishedLoops.Count - 1];
                if (Recorder.IsMainThread && __instance.part == loop.Part)
                    loop.Start = ProfilerClock.Now();
            }
            catch (Exception e)
            {
                LogFailure(e);
            }
        }

        private static void Open(List<Loop> loops, Part part, long start)
        {
            if (!Recorder.IsMainThread)
                return;
            loops.Add(new Loop { Part = part, Index = -1, Start = start });
        }

        /// <summary>
        /// Removes the part's loop, and any left above it by a loop that threw
        /// before its postfix. Null when the part has no open loop.
        /// </summary>
        private static Loop Close(List<Loop> loops, Part part)
        {
            if (!Recorder.IsMainThread)
                return null;
            for (var i = loops.Count - 1; i >= 0; i--)
            {
                if (loops[i].Part != part)
                    continue;
                var loop = loops[i];
                loops.RemoveRange(i, loops.Count - i);
                return loop;
            }
            return null;
        }

        // A profiler bug must never break the game's method: callers catch everything.
        private static void LogFailure(Exception e)
        {
            if (_failureLogged)
                return;
            _failureLogged = true;
            Debug.LogError($"[TMinus] Profiler: module start timing failed ({e.Message}); further failures are not logged");
        }
    }
}
