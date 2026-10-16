using System;
using System.Collections;
using System.Collections.Generic;
using System.Reflection;
using HarmonyLib;
using UnityEngine;

namespace TMinus.Profiler.Hooks
{
    /// <summary>
    /// Per-addon <c>Start()</c> cost. Opt-in diagnostic: it patches mod code.
    /// <para>
    /// Unity calls <c>Start</c> on the frame after an addon is created, with no
    /// common entry point, so the only way to time it per addon is to patch each
    /// addon's own <c>Start</c> method. Patching forces the method to be compiled
    /// right away, and Mono's JIT can then run static constructors of the types
    /// it references. Patching every addon up front (the first implementation)
    /// ran mods' static constructors during startup, long before their scene,
    /// and broke KerbalConstructionTime. So patching is lazy: a type's Start is
    /// patched only once the game has created an instance of it
    /// (<see cref="OnAddonCreated"/>, called after <c>AddonLoader.StartAddon</c>),
    /// in its own scene, just before Unity calls that Start. Residual
    /// difference from vanilla: Start is compiled up to one frame earlier.
    /// </para>
    /// <list type="bullet">
    /// <item><c>void Start()</c>: prefix/postfix, keyed by the instance's real type.</item>
    /// <item><c>IEnumerator Start()</c> (a coroutine): every step (<c>MoveNext</c>)
    /// is summed under the addon type.</item>
    /// </list>
    /// Requires the <see cref="AddonHooks"/> group. Work done in <c>Update</c> or in
    /// coroutines the addon starts itself is not included.
    /// </summary>
    internal sealed class AddonStartHooks : IProfilerHook
    {
        private static readonly TimingAggregate AddonStart = new TimingAggregate("addon.start", minTotalMs: 0.05);

        // Main thread only: StartAddon and Start both run there.
        private static readonly HashSet<Type> Decided = new HashSet<Type>();
        private static readonly HashSet<MethodBase> Patched = new HashSet<MethodBase>();
        private static readonly Dictionary<RuntimeMethodHandle, string> CoroutineKeys = new Dictionary<RuntimeMethodHandle, string>();

        private static Harmony _harmony;
        private static HarmonyMethod _prefix, _startPostfix, _stepPostfix;

        public string Id => "addon.start";
        public string Group => "addonStartHooks";

        /// <summary>Only prepares the patches; nothing is patched until addons are created.</summary>
        public void Apply(Harmony harmony)
        {
            _prefix = HookRegistry.Prefix(typeof(AddonStartHooks), nameof(Prefix));
            _startPostfix = HookRegistry.Postfix(typeof(AddonStartHooks), nameof(StartPostfix));
            _stepPostfix = HookRegistry.Postfix(typeof(AddonStartHooks), nameof(CoroutineStepPostfix));
            _harmony = harmony;
        }

        /// <summary>
        /// Called after <c>AddonLoader.StartAddon</c> returns. KSP also calls it for
        /// addons that don't belong to the scene and creates nothing, so first check
        /// that an instance actually exists.
        /// </summary>
        public static void OnAddonCreated(Type type)
        {
            if (_harmony == null || type == null || Decided.Contains(type))
                return;
            if (UnityEngine.Object.FindObjectOfType(type) == null)
                return;

            Decided.Add(type);
            var start = FindStart(type);
            if (start == null || !Patched.Add(start))
                return;

            try
            {
                if (typeof(IEnumerator).IsAssignableFrom(start.ReturnType))
                {
                    var moveNext = AccessTools.EnumeratorMoveNext(start)
                        ?? throw new MissingMethodException("coroutine MoveNext not found");
                    CoroutineKeys[moveNext.MethodHandle] = TypeKeys.Of(type) + " (coroutine)";
                    _harmony.Patch(moveNext, prefix: _prefix, postfix: _stepPostfix);
                }
                else
                {
                    _harmony.Patch(start, prefix: _prefix, postfix: _startPostfix);
                }
                Recorder.Mark("addon.start.hooked", TypeKeys.Of(type));
            }
            catch (Exception e)
            {
                Debug.LogWarning($"[TMinus] Profiler: cannot time {type.FullName}.Start ({e.Message})");
                Recorder.Mark("addon.start.failed", TypeKeys.Of(type));
            }
        }

        /// <summary>The Start method Unity will call: the most derived declaration below MonoBehaviour.</summary>
        private static MethodInfo FindStart(Type type)
        {
            for (var t = type; t != null && t != typeof(MonoBehaviour); t = t.BaseType)
            {
                var method = AccessTools.DeclaredMethod(t, "Start", Type.EmptyTypes);
                if (method != null && !method.IsStatic && !method.IsAbstract)
                    return method;
            }
            return null;
        }

        private static void Prefix(out long __state) => __state = ProfilerClock.Now();

        private static void StartPostfix(long __state, object __instance)
        {
            var end = ProfilerClock.Now();
            try
            {
                AddonStart.Add(TypeKeys.Of(__instance.GetType()), __state, end);
            }
            catch (Exception)
            {
                // Never break the game's method.
            }
        }

        private static void CoroutineStepPostfix(long __state, MethodBase __originalMethod)
        {
            var end = ProfilerClock.Now();
            try
            {
                if (CoroutineKeys.TryGetValue(__originalMethod.MethodHandle, out var key))
                    AddonStart.Add(key, __state, end);
            }
            catch (Exception)
            {
                // Never break the game's method.
            }
        }
    }
}
