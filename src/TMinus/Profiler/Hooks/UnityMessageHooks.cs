using System;
using System.Collections;
using System.Collections.Generic;
using System.Reflection;
using HarmonyLib;
using UnityEngine;

namespace TMinus.Profiler.Hooks
{
    /// <summary>
    /// Time in mods' Unity messages (<c>Update</c>, <c>LateUpdate</c>,
    /// <c>FixedUpdate</c>, <c>OnGUI</c>) per declaring type, during the Countdown and
    /// the Holds only (<see cref="LoadingWindow"/>). Off by default until its cost is
    /// measured on the bench (design rule 2). Design: docs/m6-web-plan.md, "Unity
    /// messages: assessment and proposal".
    /// <para>
    /// Lazy, as <see cref="AddonStartHooks"/> (the KCT rule): a type's messages are
    /// patched when T-Minus first sees an instance of it, before Unity sends it a
    /// message. Instances are seen at <c>AddonLoader.StartAddon</c>,
    /// <c>PartModule.Awake</c>, <c>VesselModule.Awake</c>, <c>ScenarioModule.Awake</c>
    /// and <c>StartCoroutine</c>. Part and vessel modules created during the loading
    /// screen are left alone: they get no messages there (inactive prefabs, stripped
    /// icons, the one-shot VesselModule instances), and their first instance in a game
    /// scene patches them. Behaviours a mod creates at none of these points are not
    /// timed.
    /// </para>
    /// <para>
    /// Only the message Unity calls (the most-derived declaration) is patched, and
    /// only when a GameData assembly other than T-Minus declares it: stock and engine
    /// messages are skipped, so nothing sits on top of KSPCF's patches of stock ones.
    /// Also skipped and counted: generic declaring types (Mono may share their code),
    /// bodiless methods, methods another T-Minus hook patches, failed patches.
    /// </para>
    /// <para>
    /// Outside the loading window the prefix only reads a bool. Inside it, a call
    /// records its own time, as coroutine steps do: timed calls inside it (a base
    /// message it calls, events, steps) keep theirs, and a call another timed call
    /// encloses moves to <c>unity.message.within</c>.
    /// </para>
    /// </summary>
    internal sealed class UnityMessageHooks : IProfilerHook
    {
        public const string GroupName = "unityMessageHooks";

        private static readonly string[] Messages = { "Update", "LateUpdate", "FixedUpdate", "OnGUI" };

        private static readonly TimingAggregate Calls = new TimingAggregate("unity.message", minTotalMs: 0.05);
        private static readonly TimingAggregate Within = new TimingAggregate("unity.message.within", minTotalMs: 0.05);

        // Main thread only: Unity creates behaviours and sends messages there.
        private static readonly HashSet<Type> Seen = new HashSet<Type>();
        private static readonly HashSet<MethodBase> Decided = new HashSet<MethodBase>();
        private static readonly Dictionary<RuntimeMethodHandle, string> Keys = new Dictionary<RuntimeMethodHandle, string>();
        private static readonly HashSet<Assembly> ModAssemblies = new HashSet<Assembly>();

        private static Harmony _harmony;
        private static HarmonyMethod _prefix, _postfix;
        private static Assembly _own;
        private static int _loadedCount = -1;
        private static int _hooked, _skipped;
        private static bool _applied;

        public string Id => "unity.message";
        public string Group => GroupName;

        public void Apply(Harmony harmony)
        {
            var startAddon = AccessTools.Method(typeof(AddonLoader), "StartAddon")
                ?? throw new MissingMethodException("AddonLoader.StartAddon not found");
            var partModuleAwake = AccessTools.Method(typeof(PartModule), nameof(PartModule.Awake), Type.EmptyTypes)
                ?? throw new MissingMethodException("PartModule.Awake not found");
            var vesselModuleAwake = AccessTools.Method(typeof(VesselModule), "Awake", Type.EmptyTypes)
                ?? throw new MissingMethodException("VesselModule.Awake not found");
            var scenarioModuleAwake = AccessTools.Method(typeof(ScenarioModule), "Awake", Type.EmptyTypes)
                ?? throw new MissingMethodException("ScenarioModule.Awake not found");
            var startCoroutine = AccessTools.Method(typeof(MonoBehaviour), nameof(MonoBehaviour.StartCoroutine), new[] { typeof(IEnumerator) })
                ?? throw new MissingMethodException("MonoBehaviour.StartCoroutine(IEnumerator) not found");

            _prefix = HookRegistry.Prefix(typeof(UnityMessageHooks), nameof(MessagePrefix));
            _postfix = HookRegistry.Postfix(typeof(UnityMessageHooks), nameof(MessagePostfix));
            _own = typeof(UnityMessageHooks).Assembly;
            _harmony = harmony;

            harmony.Patch(startAddon, postfix: HookRegistry.Postfix(typeof(UnityMessageHooks), nameof(StartAddonPostfix)));
            var moduleAwake = HookRegistry.Postfix(typeof(UnityMessageHooks), nameof(ModuleAwakePostfix));
            harmony.Patch(partModuleAwake, postfix: moduleAwake);
            harmony.Patch(vesselModuleAwake, postfix: moduleAwake);
            harmony.Patch(scenarioModuleAwake, postfix: HookRegistry.Postfix(typeof(UnityMessageHooks), nameof(BehaviourPostfix)));
            harmony.Patch(startCoroutine, prefix: HookRegistry.Prefix(typeof(UnityMessageHooks), nameof(BehaviourPrefix)));
            _applied = true;
        }

        // Parameter name must match AddonLoader.StartAddon(asm, type, addon, level).
        private static void StartAddonPostfix(Type type)
        {
            try
            {
                // KSP also calls StartAddon for addons that create nothing in this scene.
                if (type != null && Recorder.IsMainThread && !Seen.Contains(type) && UnityEngine.Object.FindObjectOfType(type) != null)
                    Discover(type);
            }
            catch (Exception)
            {
                // Never break the game's method.
            }
        }

        /// <summary>Part and vessel modules: not in the loading screen, where they get no messages.</summary>
        private static void ModuleAwakePostfix(MonoBehaviour __instance)
        {
            try
            {
                if (__instance != null && HighLogic.LoadedScene != GameScenes.LOADING && Recorder.IsMainThread)
                    Discover(__instance.GetType());
            }
            catch (Exception)
            {
                // Never break the game's method.
            }
        }

        private static void BehaviourPostfix(MonoBehaviour __instance) => BehaviourPrefix(__instance);

        private static void BehaviourPrefix(MonoBehaviour __instance)
        {
            try
            {
                if (__instance != null && Recorder.IsMainThread)
                    Discover(__instance.GetType());
            }
            catch (Exception)
            {
                // Never break the game's method.
            }
        }

        /// <summary>Patches the messages Unity will send to a type seen for the first time.</summary>
        private static void Discover(Type type)
        {
            if (!Seen.Add(type))
                return;
            foreach (var name in Messages)
            {
                var method = MessageOf(type, name);
                if (method == null || !Decided.Add(method))
                    continue; // None, or decided through another type that shares it.

                var key = $"{TypeKeys.Of(method.DeclaringType)}.{name}";
                var skip = SkipReason(method);
                if (skip != null)
                {
                    // Stock and engine messages are the common case: count them, mark the rest.
                    _skipped++;
                    if (skip != "stock")
                        Recorder.Mark("unity.message.skipped", $"{key} ({skip})");
                    continue;
                }
                try
                {
                    Keys[method.MethodHandle] = key;
                    _harmony.Patch(method, prefix: _prefix, postfix: _postfix);
                    _hooked++;
                    Recorder.Mark("unity.message.hooked", key);
                }
                catch (Exception e)
                {
                    Keys.Remove(method.MethodHandle);
                    _skipped++;
                    Debug.LogWarning($"[TMinus] Profiler: cannot time {method.DeclaringType.FullName}.{name} ({e.Message})");
                    Recorder.Mark("unity.message.skipped", $"{key} (failed)");
                }
            }
        }

        /// <summary>The method Unity calls for a message: the most-derived parameterless declaration below MonoBehaviour.</summary>
        private static MethodInfo MessageOf(Type type, string name)
        {
            const BindingFlags flags = BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.DeclaredOnly;
            for (var t = type; t != null && t != typeof(MonoBehaviour); t = t.BaseType)
            {
                foreach (var method in t.GetMethods(flags))
                {
                    if (method.Name == name && method.GetParameters().Length == 0)
                        return method;
                }
            }
            return null;
        }

        private static string SkipReason(MethodInfo method)
        {
            var assembly = method.DeclaringType.Assembly;
            if (assembly == _own || assembly.GetName().Name.StartsWith("TMinus", StringComparison.Ordinal))
                return "own";
            if (!IsModAssembly(assembly))
                return "stock";
            if (method.DeclaringType.IsGenericType || method.DeclaringType.ContainsGenericParameters)
                return "generic";
            if (method.IsAbstract || method.GetMethodBody() == null)
                return "no body";
            if (Harmony.GetPatchInfo(method)?.Owners.Contains(_harmony.Id) == true)
                return "timed elsewhere";
            return null;
        }

        /// <summary>
        /// An assembly KSP loaded from GameData (a mod's), as opposed to stock, engine and
        /// framework ones. KSP lists its own Assembly-CSharp first in the same list (as
        /// "KSP", from AssemblyLoader's initialization), so it is left out by identity.
        /// </summary>
        private static bool IsModAssembly(Assembly assembly)
        {
            var loaded = AssemblyLoader.loadedAssemblies;
            if (loaded.Count != _loadedCount)
            {
                ModAssemblies.Clear();
                foreach (var a in loaded)
                {
                    if (a.assembly != null && a.assembly != typeof(AssemblyLoader).Assembly)
                        ModAssemblies.Add(a.assembly);
                }
                _loadedCount = loaded.Count;
            }
            return ModAssemblies.Contains(assembly);
        }

        private static void MessagePrefix(out long __state) =>
            __state = LoadingWindow.IsOpen && Recorder.IsMainThread ? ProfilerClock.Now() : 0;

        private static void MessagePostfix(long __state, MethodBase __originalMethod)
        {
            if (__state == 0)
                return;
            var end = ProfilerClock.Now();
            try
            {
                if (Keys.TryGetValue(__originalMethod.MethodHandle, out var key))
                    Calls.Add(key, __state, end, Within);
            }
            catch (Exception)
            {
                // Never break the game's method.
            }
        }

        /// <summary>Writes the methods hooked and skipped since the previous checkpoint, then resets the counts.</summary>
        public static void EmitAll()
        {
            if (!_applied)
                return;
            Recorder.Counter("unity.message.hooked", _hooked);
            Recorder.Counter("unity.message.skipped", _skipped);
            _hooked = _skipped = 0;
        }
    }
}
