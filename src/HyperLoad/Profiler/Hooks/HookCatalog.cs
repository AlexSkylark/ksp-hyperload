using System.Collections.Generic;
using HarmonyLib;

namespace HyperLoad.Profiler.Hooks
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

            return new List<IProfilerHook>
            {
                loaderStartHook,
                new SetupMainLoadersHook(),

                // Full GameData scans. The first one runs before HyperLoad loads; this
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

                // Drag cube generation is a coroutine: time each step (MoveNext), which
                // sums the main-thread work and leaves out the frames it waits.
                TimedMethodHook.Aggregated("dragCubes.setup", StartupGroup,
                    () => AccessTools.EnumeratorMoveNext(AccessTools.Method(typeof(DragCubeSystem), "SetupDragCubeCoroutine", new[] { typeof(Part) })),
                    partLoader, "DragCubeSystem.SetupDragCubeCoroutine(Part) steps"),
                TimedMethodHook.Aggregated("dragCubes.setupFromConfig", StartupGroup,
                    () => AccessTools.EnumeratorMoveNext(AccessTools.Method(typeof(DragCubeSystem), "SetupDragCubeCoroutine", new[] { typeof(Part), typeof(ConfigNode) })),
                    partLoader, "DragCubeSystem.SetupDragCubeCoroutine(Part, ConfigNode) steps"),

                new AddonHooks(),
            };
        }
    }
}
