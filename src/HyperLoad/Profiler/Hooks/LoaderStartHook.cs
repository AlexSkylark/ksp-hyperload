using System;
using System.Collections.Generic;
using System.Reflection;
using HarmonyLib;

namespace HyperLoad.Profiler.Hooks
{
    /// <summary>
    /// Records the exact start of each loading-screen loader by prefixing its
    /// <c>StartLoad()</c>. Covers the loaders registered when the profiler starts
    /// (stock ones and ModuleManager's PostPatchLoader); loaders added later are
    /// still timed by <see cref="LoadingScreenMonitor"/>, with a polled start.
    /// </summary>
    internal sealed class LoaderStartHook : IProfilerHook
    {
        public string Id => "loader.startLoad";
        public string Group => "startupHooks";

        public void Apply(Harmony harmony)
        {
            var screen = LoadingScreen.Instance;
            if (screen == null)
                throw new InvalidOperationException("LoadingScreen.Instance is null");

            // Loaders that don't override StartLoad share the base method: patch each method once.
            var patched = new HashSet<MethodBase>();
            var prefix = HookRegistry.Prefix(typeof(LoaderStartHook), nameof(Prefix));
            foreach (var loader in screen.loaders)
            {
                var method = AccessTools.Method(loader.GetType(), nameof(LoadingSystem.StartLoad));
                if (method != null && patched.Add(method))
                    harmony.Patch(method, prefix: prefix);
            }

            if (patched.Count == 0)
                throw new InvalidOperationException("no StartLoad method found");
        }

        private static void Prefix(LoadingSystem __instance) => LoadingScreenMonitor.NotifyStartLoad(__instance);
    }
}
