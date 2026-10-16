using System;
using System.Collections;
using System.Collections.Generic;
using System.Reflection;
using System.Runtime.CompilerServices;
using HarmonyLib;
using UnityEngine;

namespace TMinus.Profiler.Hooks
{
    /// <summary>
    /// Time in every coroutine step (<c>MoveNext</c>), per enumerator type. Opt-in
    /// until its cost is measured (design rule 2); it patches mod code. Design and
    /// census: docs/m6-web-plan.md, "Order decided", item 2.
    /// <para>
    /// Lazy, as <see cref="AddonStartHooks"/> (the KCT rule): a type's <c>MoveNext</c>
    /// is patched when the first enumerator of that type is handed to Unity, just
    /// before Unity runs its first step, so the method compiles microseconds earlier
    /// than in vanilla. Types are found three ways:
    /// <list type="bullet">
    /// <item><c>StartCoroutine(IEnumerator)</c>: a prefix sees the enumerator.</item>
    /// <item><c>StartCoroutine(string, object)</c>: Unity creates the enumerator
    /// natively; the prefix finds the named method on the behaviour and the iterator
    /// type it creates (compiler iterators only).</item>
    /// <item>Nested coroutines: a timed step of a compiler iterator that yields an
    /// <c>IEnumerator</c> hands Unity a coroutine no <c>StartCoroutine</c> shows. The
    /// postfix reads the compiler's <c>&lt;&gt;2__current</c> field (never a custom
    /// <c>Current</c> getter) and patches that type before Unity runs it.</item>
    /// </list>
    /// </para>
    /// <para>
    /// Not patched, and counted as skipped: generic types (Mono may share their
    /// code), engine (<c>UnityEngine*</c>) and T-Minus types, methods another
    /// T-Minus hook already patches (coroutine <c>Start</c>s, drag cubes), and
    /// failed patches. Enumerators driven by hand are timed only when they also
    /// reach Unity.
    /// </para>
    /// <para>
    /// Steps are synchronous, so they count as covered frame time. A step inside
    /// another timed call (the first step runs inside <c>StartCoroutine</c>, which
    /// may be inside a timed <c>Start</c> or event; a step driven by hand inside
    /// another step) moves to <c>coroutine.step.within</c>: its time is already in
    /// the enclosing call. A step records only its own time: timed calls inside it,
    /// nested steps included, keep theirs. A step that throws is not recorded.
    /// </para>
    /// <para>
    /// Loader coroutines go to <c>coroutine.step.loading</c>: the ones started on a
    /// <see cref="LoadingSystem"/> (the loading screen's loaders, whose work is the
    /// Countdown's stages, split per mod by other records) and the nested ones they
    /// yield. A loader step runs other mods' work (parts, configs, callbacks), so its
    /// owner is not the mod whose code took the time. A type is classified when it is
    /// first seen.
    /// </para>
    /// </summary>
    internal sealed class CoroutineHooks : IProfilerHook
    {
        public const string GroupName = "coroutineHooks";

        private static readonly TimingAggregate Steps = new TimingAggregate("coroutine.step", minTotalMs: 0.05);
        private static readonly TimingAggregate Within = new TimingAggregate("coroutine.step.within", minTotalMs: 0.05);
        private static readonly TimingAggregate Loading = new TimingAggregate("coroutine.step.loading", minTotalMs: 0.05);

        // Main thread only: Unity starts and steps coroutines there.
        private static readonly HashSet<Type> Seen = new HashSet<Type>();
        private static readonly HashSet<string> SeenByName = new HashSet<string>();
        private static readonly HashSet<MethodBase> Patched = new HashSet<MethodBase>();
        /// <summary>The compiler's current-value field, for the patched compiler iterators.</summary>
        private static readonly Dictionary<Type, FieldInfo> CurrentFields = new Dictionary<Type, FieldInfo>();
        private static readonly Dictionary<Type, string> Keys = new Dictionary<Type, string>();
        private static readonly HashSet<Type> LoaderTypes = new HashSet<Type>();

        private static Harmony _harmony;
        private static HarmonyMethod _prefix, _postfix;
        private static Assembly _own;
        private static int _hooked, _skipped, _byNameUnresolved;
        private static bool _applied;

        public string Id => "coroutine.step";
        public string Group => GroupName;

        public void Apply(Harmony harmony)
        {
            var byEnumerator = AccessTools.Method(typeof(MonoBehaviour), nameof(MonoBehaviour.StartCoroutine), new[] { typeof(IEnumerator) })
                ?? throw new MissingMethodException("MonoBehaviour.StartCoroutine(IEnumerator) not found");
            // StartCoroutine(string) calls this one.
            var byName = AccessTools.Method(typeof(MonoBehaviour), nameof(MonoBehaviour.StartCoroutine), new[] { typeof(string), typeof(object) })
                ?? throw new MissingMethodException("MonoBehaviour.StartCoroutine(string, object) not found");
            _prefix = HookRegistry.Prefix(typeof(CoroutineHooks), nameof(StepPrefix));
            _postfix = HookRegistry.Postfix(typeof(CoroutineHooks), nameof(StepPostfix));
            _own = typeof(CoroutineHooks).Assembly;
            _harmony = harmony;
            harmony.Patch(byEnumerator, prefix: HookRegistry.Prefix(typeof(CoroutineHooks), nameof(EnumeratorPrefix)));
            harmony.Patch(byName, prefix: HookRegistry.Prefix(typeof(CoroutineHooks), nameof(ByNamePrefix)));
            _applied = true;
        }

        private static void EnumeratorPrefix(MonoBehaviour __instance, IEnumerator routine)
        {
            try
            {
                if (routine != null && Recorder.IsMainThread)
                    Discover(routine.GetType(), __instance is LoadingSystem);
            }
            catch (Exception)
            {
                // Never break the game's method.
            }
        }

        private static void ByNamePrefix(MonoBehaviour __instance, string methodName)
        {
            try
            {
                if (__instance == null || methodName == null || !Recorder.IsMainThread)
                    return;
                var type = __instance.GetType();
                if (!SeenByName.Add($"{type.AssemblyQualifiedName}.{methodName}"))
                    return;
                var moveNext = IteratorOf(type, methodName);
                if (moveNext == null)
                {
                    _byNameUnresolved++;
                    Recorder.Mark("coroutine.byName.unresolved", $"{TypeKeys.Of(type)}.{methodName}");
                    return;
                }
                Discover(moveNext.DeclaringType, __instance is LoadingSystem);
            }
            catch (Exception)
            {
                // Never break the game's method.
            }
        }

        /// <summary>The MoveNext of the iterator a coroutine method creates, as Unity finds it by name.</summary>
        private static MethodInfo IteratorOf(Type type, string methodName)
        {
            const BindingFlags flags = BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.DeclaredOnly;
            for (var t = type; t != null && t != typeof(MonoBehaviour); t = t.BaseType)
            {
                foreach (var method in t.GetMethods(flags))
                {
                    if (method.Name == methodName && method.ReturnType == typeof(IEnumerator) && method.GetParameters().Length <= 1)
                        return AccessTools.EnumeratorMoveNext(method);
                }
            }
            return null;
        }

        /// <summary>Patches the MoveNext of an enumerator type seen for the first time, or records why not.</summary>
        private static void Discover(Type type, bool loader)
        {
            if (!Seen.Add(type))
                return;
            if (loader)
                LoaderTypes.Add(type);

            var key = KeyOf(type);
            var moveNext = MoveNextOf(type);
            var skip = SkipReason(type, moveNext);
            if (skip != null)
            {
                Skip(key, skip);
                return;
            }
            if (!Patched.Add(moveNext))
                return; // Shared with a type already patched (a common base class).

            try
            {
                if (type.IsDefined(typeof(CompilerGeneratedAttribute), false))
                    CurrentFields[type] = AccessTools.Field(type, "<>2__current");
                _harmony.Patch(moveNext, prefix: _prefix, postfix: _postfix);
                _hooked++;
                Recorder.Mark("coroutine.hooked", key);
            }
            catch (Exception e)
            {
                CurrentFields.Remove(type);
                Debug.LogWarning($"[TMinus] Profiler: cannot time coroutine {type.FullName} ({e.Message})");
                Skip(key, "failed");
            }
        }

        private static string SkipReason(Type type, MethodInfo moveNext)
        {
            if (type.IsGenericType)
                return "generic";
            if (moveNext == null || moveNext.IsAbstract || moveNext.GetMethodBody() == null)
                return "no body";
            var assembly = moveNext.DeclaringType.Assembly;
            if (assembly == _own || assembly.GetName().Name.StartsWith("TMinus", StringComparison.Ordinal))
                return "own";
            if (assembly.GetName().Name.StartsWith("UnityEngine", StringComparison.Ordinal))
                return "engine";
            if (Harmony.GetPatchInfo(moveNext)?.Owners.Contains(_harmony.Id) == true && !Patched.Contains(moveNext))
                return "timed elsewhere";
            return null;
        }

        private static void Skip(string key, string reason)
        {
            _skipped++;
            Recorder.Mark("coroutine.skipped", $"{key} ({reason})");
        }

        /// <summary>The method <c>IEnumerator.MoveNext</c> runs on this type, declared there or in a base class.</summary>
        private static MethodInfo MoveNextOf(Type type)
        {
            var map = type.GetInterfaceMap(typeof(IEnumerator));
            for (var i = 0; i < map.InterfaceMethods.Length; i++)
            {
                if (map.InterfaceMethods[i].Name == nameof(IEnumerator.MoveNext))
                    return map.TargetMethods[i];
            }
            return null;
        }

        private static string KeyOf(Type type)
        {
            if (!Keys.TryGetValue(type, out var key))
                Keys.Add(type, key = TypeKeys.Of(type));
            return key;
        }

        private static void StepPrefix(out long __state) => __state = ProfilerClock.Now();

        private static void StepPostfix(long __state, object __instance, bool __result)
        {
            var end = ProfilerClock.Now();
            try
            {
                if (!Recorder.IsMainThread)
                    return;
                var type = __instance.GetType();
                var loader = LoaderTypes.Contains(type);
                // A loader step stays a loader step when another timed call encloses it.
                if (loader)
                    Loading.Add(KeyOf(type), __state, end, Loading);
                else
                    Steps.Add(KeyOf(type), __state, end, Within);
                // A yielded enumerator is a nested coroutine Unity runs next.
                if (__result && CurrentFields.TryGetValue(type, out var current) && current != null
                    && current.GetValue(__instance) is IEnumerator nested)
                    Discover(nested.GetType(), loader);
            }
            catch (Exception)
            {
                // Never break the game's method.
            }
        }

        /// <summary>Writes the types hooked and skipped since the previous checkpoint, then resets the counts.</summary>
        public static void EmitAll()
        {
            if (!_applied)
                return;
            Recorder.Counter("coroutine.types.hooked", _hooked);
            Recorder.Counter("coroutine.types.skipped", _skipped);
            Recorder.Counter("coroutine.byName.unresolved", _byNameUnresolved);
            _hooked = _skipped = _byNameUnresolved = 0;
        }
    }
}
