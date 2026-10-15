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
    /// <item>"Ready" candidates: <c>LoadingBufferMask.Hide</c>, <c>MainMenu.Start</c>,
    /// <c>SpaceTracking.Start</c> (see <see cref="SceneTransitionTracker"/>).</item>
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
                Recorder.Span("scene.bufferedLoad.step", __state, end);
            }
            catch (Exception)
            {
                // Never break the game's method.
            }
        }

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
    /// the module (Awake) and loads its saved state (OnLoad). Keyed by module name.
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
        private static void Postfix(long __state, ConfigNode node)
        {
            var end = ProfilerClock.Now();
            try
            {
                ScenarioLoad.Add(node?.GetValue("name") ?? "(unnamed)", __state, end);
            }
            catch (Exception)
            {
                // Never break the game's method.
            }
        }
    }
}
