using System;
using HarmonyLib;
using KSP.UI.Screens;

namespace TMinus.Profiler.Hooks
{
    /// <summary>
    /// Scene-transition hooks, all on KSP's own methods:
    /// <list type="bullet">
    /// <item><c>HighLogic.LoadScene</c> prefix: a transition starts.</item>
    /// <item><c>HighLogic.bufferedLoad</c> steps: KSP's buffered scene switch, where it
    /// unloads unused assets and runs a garbage collection. Each step is one span.</item>
    /// <item><c>LoadingBufferMask.Show</c> and <c>Hide</c>: whether the loading overlay
    /// is up, which decides "ready" (see <see cref="SceneTransitionTracker"/>).</item>
    /// <item>Other milestones: <c>MainMenu.Start</c>, <c>SpaceTracking.Start</c>.</item>
    /// </list>
    /// </summary>
    internal sealed class SceneHooks : IProfilerHook
    {
        public const string SceneGroup = "sceneHooks";

        public string Id => "scene.transitions";
        public string Group => SceneGroup;

        public void Apply(Harmony harmony)
        {
            Patch(harmony, AccessTools.Method(typeof(HighLogic), nameof(HighLogic.LoadScene), new[] { typeof(GameScenes) }),
                prefix: nameof(LoadScenePrefix));

            var bufferedLoad = AccessTools.Method(typeof(HighLogic), "bufferedLoad")
                ?? throw new MissingMethodException("HighLogic.bufferedLoad");
            Patch(harmony, AccessTools.EnumeratorMoveNext(bufferedLoad),
                prefix: nameof(StepPrefix), postfix: nameof(BufferedLoadStepPostfix));

            Patch(harmony, AccessTools.Method(typeof(LoadingBufferMask), "Show"), postfix: nameof(MaskShowPostfix));
            Patch(harmony, AccessTools.Method(typeof(LoadingBufferMask), "Hide"), postfix: nameof(MaskHidePostfix));
            Patch(harmony, AccessTools.Method(typeof(MainMenu), "Start"), postfix: nameof(MainMenuStartPostfix));
            Patch(harmony, AccessTools.Method(typeof(SpaceTracking), "Start"), postfix: nameof(SpaceTrackingStartPostfix));
        }

        private static void Patch(Harmony harmony, System.Reflection.MethodBase target, string prefix = null, string postfix = null)
        {
            if (target == null)
                throw new MissingMethodException($"target for {prefix ?? postfix} not found");
            harmony.Patch(target,
                prefix: prefix == null ? null : HookRegistry.Prefix(typeof(SceneHooks), prefix),
                postfix: postfix == null ? null : HookRegistry.Postfix(typeof(SceneHooks), postfix));
        }

        // GameScenes is a value type, so this prefix still runs if another mod skips LoadScene.
        private static void LoadScenePrefix(GameScenes scene)
        {
            try
            {
                SceneTransitionTracker.OnLoadSceneRequested(scene);
            }
            catch (Exception)
            {
                // Never break the game's method.
            }
        }

        private static void StepPrefix(out long __state) => __state = ProfilerClock.Now();

        private static void BufferedLoadStepPostfix(long __state)
        {
            var end = ProfilerClock.Now();
            try
            {
                FrameCoverage.Add(__state, end);
                Recorder.Span("scene.bufferedLoad.step", __state, end);
            }
            catch (Exception)
            {
                // Never break the game's method.
            }
        }

        private static void MaskShowPostfix() => Marker(SceneTransitionTracker.MaskShown);

        private static void MaskHidePostfix() => Marker(SceneTransitionTracker.MaskHidden);

        private static void MainMenuStartPostfix() => Marker("MainMenu.Start");

        private static void SpaceTrackingStartPostfix() => Marker("SpaceTracking.Start");

        private static void Marker(string marker)
        {
            try
            {
                SceneTransitionTracker.OnMarker(marker, HighLogic.LoadedScene);
            }
            catch (Exception)
            {
                // Never break the game's method.
            }
        }
    }

    /// <summary>
    /// Per-ScenarioModule load cost: <c>ScenarioRunner.AddModule(ConfigNode)</c> creates
    /// the module (Awake) and loads its saved state (OnLoad). Keyed by the module's
    /// type (<c>&lt;assembly&gt;/&lt;type&gt;</c>, so the analyzer knows its mod); by the
    /// node's name when no module was created (the method returns null).
    /// </summary>
    internal sealed class ScenarioModuleHook : IProfilerHook
    {
        private static readonly TimingAggregate ScenarioLoad = new TimingAggregate("scenario.load", minTotalMs: 0.05);

        public string Id => "scenario.load";
        public string Group => SceneHooks.SceneGroup;

        public void Apply(Harmony harmony)
        {
            var method = AccessTools.Method(typeof(ScenarioRunner), nameof(ScenarioRunner.AddModule), new[] { typeof(ConfigNode) })
                ?? throw new MissingMethodException("ScenarioRunner.AddModule(ConfigNode)");
            harmony.Patch(method,
                prefix: HookRegistry.Prefix(typeof(ScenarioModuleHook), nameof(Prefix)),
                postfix: HookRegistry.Postfix(typeof(ScenarioModuleHook), nameof(Postfix)));
        }

        private static void Prefix(out long __state) => __state = ProfilerClock.Now();

        // Parameter name must match ScenarioRunner.AddModule(node).
        private static void Postfix(long __state, ConfigNode node, ScenarioModule __result)
        {
            var end = ProfilerClock.Now();
            try
            {
                ScenarioLoad.Add(__result != null ? TypeKeys.Of(__result.GetType()) : node?.GetValue("name") ?? "(unnamed)", __state, end);
            }
            catch (Exception)
            {
                // Never break the game's method.
            }
        }
    }

    /// <summary>
    /// Terrain start per body: <c>PQS.ForceStart</c> builds a body's terrain
    /// synchronously, in the frame of the scene's setup (space center: home body;
    /// flight: the vessel's body). Terrain mods run inside it. Keyed by the PQS
    /// object's name. KSPCF transpiles <c>PQS.StartSphere</c> and
    /// <c>ResetAndWait</c>, not <c>ForceStart</c> (docs/mechanisms.md, 6.6).
    /// </summary>
    internal sealed class PqsStartHook : IProfilerHook
    {
        private static readonly TimingAggregate PqsStart = new TimingAggregate("pqs.forceStart");

        public string Id => "pqs.forceStart";
        public string Group => SceneHooks.SceneGroup;

        public void Apply(Harmony harmony)
        {
            var method = AccessTools.Method(typeof(PQS), nameof(PQS.ForceStart), Type.EmptyTypes)
                ?? throw new MissingMethodException("PQS.ForceStart()");
            harmony.Patch(method,
                prefix: HookRegistry.Prefix(typeof(PqsStartHook), nameof(Prefix)),
                postfix: HookRegistry.Postfix(typeof(PqsStartHook), nameof(Postfix)));
        }

        private static void Prefix(out long __state) => __state = ProfilerClock.Now();

        private static void Postfix(long __state, PQS __instance)
        {
            var end = ProfilerClock.Now();
            try
            {
                PqsStart.Add(__instance != null ? __instance.name : "(unknown)", __state, end);
            }
            catch (Exception)
            {
                // Never break the game's method.
            }
        }
    }
}
