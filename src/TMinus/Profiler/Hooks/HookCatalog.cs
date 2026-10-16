using System;
using System.Collections.Generic;
using HarmonyLib;

namespace TMinus.Profiler.Hooks
{
    /// <summary>
    /// Every hook the profiler applies, in one place. Targets were chosen to work
    /// with and without KSPCF's FastLoader (see docs/phase1-profiler-scope.md):
    /// stock methods that FastLoader bypasses are timed only when they actually run.
    /// </summary>
    internal static class HookCatalog
    {
        public const string StartupGroup = "startupHooks";

        public static List<IProfilerHook> Create(LoaderStartHook loaderStartHook)
        {
            // Methods of one part's compilation. They nest: ParsePart includes
            // CompileModel and CreatePartIcon, internals call CompileModel too.
            var partLoader = new TimingAggregate("partLoader.methods");

            var hooks = new List<IProfilerHook>
            {
                // First, so every later patch is timed, T-Minus' own included.
                new HarmonyHooks(),
                loaderStartHook,
                new SetupMainLoadersHook(),

                // Full GameData scans. The first one runs before T-Minus loads; this
                // catches the second (stock, or inside FastLoader).
                TimedMethodHook.Span("gameDatabase.urlDir", StartupGroup,
                    () => AccessTools.Constructor(typeof(UrlDir), new[] { typeof(UrlDir.ConfigDirectory[]), typeof(UrlDir.ConfigFileType[]) }),
                    "gameDatabase.urlDir"),
                // Stock only: FastLoader uses its own translation.
                TimedMethodHook.Span("gameDatabase.translateLoadedNodes", StartupGroup,
                    () => AccessTools.Method(typeof(GameDatabase), "translateLoadedNodes"),
                    "gameDatabase.translateLoadedNodes"),

                // Every config file read, split by thread: ModuleManager reads from a
                // background thread while assets load on the main thread.
                TimedMethodHook.Aggregated("configNode.load", StartupGroup,
                    () => AccessTools.Method(typeof(ConfigNode), nameof(ConfigNode.Load), new[] { typeof(string), typeof(bool) }),
                    new TimingAggregate("configNode.load")),

                new PartParseHook(),
                TimedMethodHook.Aggregated("partLoader.compileModel", StartupGroup,
                    () => AccessTools.Method(typeof(PartLoader), "CompileModel"), partLoader, "CompileModel"),
                TimedMethodHook.Aggregated("partLoader.createPartIcon", StartupGroup,
                    () => AccessTools.Method(typeof(PartLoader), "CreatePartIcon"), partLoader, "CreatePartIcon"),
                TimedMethodHook.Aggregated("partLoader.compilePartInfo", StartupGroup,
                    () => AccessTools.Method(typeof(PartLoader), "CompilePartInfo"), partLoader, "CompilePartInfo"),
                TimedMethodHook.Aggregated("partLoader.loadInternalProp", StartupGroup,
                    () => AccessTools.Method(typeof(PartLoader), "LoadInternalProp"), partLoader, "LoadInternalProp"),
                TimedMethodHook.Aggregated("partLoader.loadInternalSpace", StartupGroup,
                    () => AccessTools.Method(typeof(PartLoader), "LoadInternalSpace"), partLoader, "LoadInternalSpace"),

                // Drag cubes per part: a coroutine whose rendering runs in a nested
                // coroutine (stock) or KSPCF's own (DragCubeGeneration), so time it from
                // its first step to its last, frames included (docs/mechanisms.md, 3.2).
                new EnumeratorSpanHook("dragCubes.setup", StartupGroup,
                    () => AccessTools.Method(typeof(DragCubeSystem), "SetupDragCubeCoroutine", new[] { typeof(Part) }),
                    partLoader, "DragCubeSystem.SetupDragCubeCoroutine(Part) span"),
                new EnumeratorSpanHook("dragCubes.setupFromConfig", StartupGroup,
                    () => AccessTools.Method(typeof(DragCubeSystem), "SetupDragCubeCoroutine", new[] { typeof(Part), typeof(ConfigNode) }),
                    partLoader, "DragCubeSystem.SetupDragCubeCoroutine(Part, ConfigNode) span"),

                new AddonHooks(),
                new AddonStartHooks(),

                // Every coroutine step, per enumerator type (patched lazily).
                new CoroutineHooks(),

                // Time inside every GameEvent dispatch (mods' handlers).
                new GameEventHooks(),

                // Scene transitions.
                new SceneHooks(),
                new ScenarioModuleHook(),
                new PqsStartHook(),
                TimedMethodHook.Span("game.loadSave", SceneHooks.SceneGroup,
                    () => AccessTools.Method(typeof(GamePersistence), nameof(GamePersistence.LoadGame),
                        new[] { typeof(string), typeof(string), typeof(bool), typeof(bool) }),
                    "game.loadSave"),
                TimedMethodHook.Span("game.save", SceneHooks.SceneGroup,
                    () => AccessTools.Method(typeof(GamePersistence), nameof(GamePersistence.SaveGame),
                        new[] { typeof(Game), typeof(string), typeof(string), typeof(SaveMode) }),
                    "game.save"),
                TimedMethodHook.Span("game.load", SceneHooks.SceneGroup,
                    () => AccessTools.Method(typeof(Game), nameof(Game.Load), Type.EmptyTypes),
                    "game.load"),
            };

            // PartModule and VesselModule code, by module type, part and vessel.
            hooks.AddRange(ModuleHooks.Create());

            // Last, so every T-Minus hook is already in place and is skipped.
            hooks.Add(new HarmonyCallHooks());
            return hooks;
        }
    }
}
