using System;
using System.Collections.Generic;
using System.Reflection;
using HarmonyLib;

namespace TMinus.Profiler.Hooks
{
    /// <summary>
    /// Records the exact start of each loading-screen loader by prefixing its
    /// <c>StartLoad()</c>. Mods register loaders from their own Instantly addons,
    /// many of which run after ours, so <see cref="PatchLoaders"/> is called again
    /// whenever the loader list changes; a loader is only missed if it is added
    /// right before it starts.
    /// </summary>
    internal sealed class LoaderStartHook : IProfilerHook
    {
        private readonly HashSet<MethodBase> _patched = new HashSet<MethodBase>();
        private Harmony _harmony;

        public string Id => "loader.startLoad";
        public string Group => "startupHooks";

        public void Apply(Harmony harmony)
        {
            var screen = LoadingScreen.Instance;
            if (screen == null)
                throw new InvalidOperationException("LoadingScreen.Instance is null");

            _harmony = harmony;
            PatchLoaders(screen.loaders);
            if (_patched.Count == 0)
            {
                _harmony = null;
                throw new InvalidOperationException("no StartLoad method found");
            }
        }

        /// <summary>Patches loaders not seen before. Does nothing if the hook was not applied.</summary>
        public void PatchLoaders(IEnumerable<LoadingSystem> loaders)
        {
            if (_harmony == null)
                return;

            var prefix = HookRegistry.Prefix(typeof(LoaderStartHook), nameof(Prefix));
            List<string> failed = null;
            foreach (var loader in loaders)
            {
                try
                {
                    var method = DeclaredStartLoad(loader.GetType());
                    if (method != null && _patched.Add(method))
                        _harmony.Patch(method, prefix: prefix);
                }
                catch (Exception e)
                {
                    // One bad loader must not stop the others from being hooked.
                    (failed ?? (failed = new List<string>())).Add($"{loader.GetType().FullName}: {e.Message}");
                }
            }

            if (failed != null)
                throw new InvalidOperationException(string.Join("; ", failed.ToArray()));
        }

        /// <summary>
        /// The StartLoad implementation a loader actually runs. Harmony only patches a
        /// method on the type that declares it, so for a loader that doesn't override
        /// StartLoad this is the base class method (shared by all such loaders).
        /// </summary>
        private static MethodBase DeclaredStartLoad(Type loaderType)
        {
            for (var type = loaderType; type != null; type = type.BaseType)
            {
                var method = AccessTools.DeclaredMethod(type, nameof(LoadingSystem.StartLoad), Type.EmptyTypes);
                if (method != null)
                    return method;
            }
            return null;
        }

        private static void Prefix(LoadingSystem __instance) => LoadingScreenMonitor.NotifyStartLoad(__instance);
    }
}
