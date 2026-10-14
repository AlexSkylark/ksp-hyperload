using System;
using HarmonyLib;

namespace HyperLoad.Profiler.Hooks
{
    /// <summary>
    /// Marks the moment GameDatabase moves from assemblies/configs to asset
    /// loading (<c>GameDatabase.SetupMainLoaders</c>). KSPCF's FastLoader
    /// prefixes this method and throws on purpose to stop stock loading, so a
    /// postfix would never run: a finalizer records whether it threw. The
    /// finalizer returns void, which makes Harmony rethrow the original
    /// exception unchanged (Harmony 2.2.1, <c>MethodPatcher.AddFinalizers</c>).
    /// </summary>
    internal sealed class SetupMainLoadersHook : IProfilerHook
    {
        public string Id => "gameDatabase.setupMainLoaders";
        public string Group => "startupHooks";

        public void Apply(Harmony harmony)
        {
            var method = AccessTools.Method(typeof(GameDatabase), "SetupMainLoaders")
                ?? throw new MissingMethodException("GameDatabase.SetupMainLoaders");

            harmony.Patch(method,
                prefix: HookRegistry.Prefix(typeof(SetupMainLoadersHook), nameof(Prefix)),
                finalizer: new HarmonyMethod(AccessTools.Method(typeof(SetupMainLoadersHook), nameof(Finalizer))) { priority = Priority.Last });
        }

        private static void Prefix() => Recorder.Mark("gameDatabase.setupMainLoaders");

        private static void Finalizer(Exception __exception)
        {
            if (__exception != null)
                Recorder.Mark("gameDatabase.setupMainLoaders.threw", __exception.GetType().Name);
        }
    }
}
