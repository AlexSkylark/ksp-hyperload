using System;
using System.Collections.Generic;
using HarmonyLib;
using UnityEngine;

namespace HyperLoad.Profiler
{
    /// <summary>
    /// One measurement point patched into the game. Implementations must stay at
    /// optimization level 0: observe only, never change behavior.
    /// </summary>
    internal interface IProfilerHook
    {
        /// <summary>Stable identifier used in logs and output.</summary>
        string Id { get; }

        /// <summary>Settings key that turns this hook on or off (see <see cref="ProfilerSettings"/>).</summary>
        string Group { get; }

        /// <summary>Applies the patches. Throws if the hook cannot be applied.</summary>
        void Apply(Harmony harmony);
    }

    /// <summary>
    /// Applies hooks one by one. A hook that fails is logged and skipped; the
    /// profiler keeps running without that measurement.
    /// </summary>
    internal static class HookRegistry
    {
        public static void ApplyAll(Harmony harmony, ProfilerSettings settings, IEnumerable<IProfilerHook> hooks)
        {
            int applied = 0, disabled = 0, unavailable = 0;

            foreach (var hook in hooks)
            {
                if (!settings.IsGroupEnabled(hook.Group))
                {
                    disabled++;
                    continue;
                }

                try
                {
                    hook.Apply(harmony);
                    applied++;
                }
                catch (Exception e)
                {
                    unavailable++;
                    Debug.LogWarning($"[HyperLoad] Profiler: hook {hook.Id} unavailable ({e.GetType().Name}: {e.Message})");
                    Recorder.Mark("hook.unavailable", hook.Id);
                }
            }

            Debug.Log($"[HyperLoad] Profiler: {applied} hooks applied, {unavailable} unavailable, {disabled} disabled by settings");
        }

        /// <summary>
        /// A prefix that runs before other mods' prefixes. To keep running even after
        /// another mod's prefix skips the original method (returns false), the prefix
        /// method must return void and take only <c>__instance</c>, <c>__state</c> or
        /// value-type parameters.
        /// </summary>
        public static HarmonyMethod Prefix(Type type, string methodName) =>
            new HarmonyMethod(AccessTools.Method(type, methodName)) { priority = Priority.First };

        /// <summary>A postfix that runs after other mods' postfixes.</summary>
        public static HarmonyMethod Postfix(Type type, string methodName) =>
            new HarmonyMethod(AccessTools.Method(type, methodName)) { priority = Priority.Last };
    }
}
