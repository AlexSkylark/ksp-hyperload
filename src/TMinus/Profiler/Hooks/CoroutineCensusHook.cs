using System;
using System.Collections;
using System.Collections.Generic;
using HarmonyLib;
using UnityEngine;

namespace TMinus.Profiler.Hooks
{
    /// <summary>
    /// Counts the coroutines the game and mods start, per enumerator type,
    /// without timing them. DIAGNOSTIC, off by default: it answers how many types
    /// a session starts, which decides the cost of timing each type's
    /// <c>MoveNext</c> (one Harmony rebuild per type; see "Assessment: measuring
    /// every coroutine" in docs/m6-web-plan.md).
    /// <para>
    /// <c>MonoBehaviour.StartCoroutine(IEnumerator)</c> is managed and too large
    /// for Mono to inline, so a prefix sees every enumerator started that way.
    /// <c>StartCoroutine(string, object)</c> creates the enumerator natively: the
    /// prefix sees only the behaviour and the method name. Not seen: nested
    /// coroutines yielded without <c>StartCoroutine</c>, and enumerators driven
    /// by hand (KSPCF's FastLoader). The counts are a lower bound.
    /// </para>
    /// Written at each checkpoint: <c>coroutine.start</c> per type started since
    /// the previous one (count only), and counters for the types seen for the
    /// first time.
    /// </summary>
    internal sealed class CoroutineCensusHook : IProfilerHook
    {
        public const string GroupName = "coroutineCensus";

        private struct Started
        {
            public long Count;
        }

        // Main thread only: Unity starts coroutines there.
        private static readonly Dictionary<string, Started> SinceCheckpoint = new Dictionary<string, Started>();
        private static readonly HashSet<Type> SeenTypes = new HashSet<Type>();
        private static readonly HashSet<string> SeenByName = new HashSet<string>();
        private static int _newTypes, _newGeneric, _newCustom, _newByName;
        private static bool _applied;

        public string Id => "coroutine.census";
        public string Group => GroupName;

        public void Apply(Harmony harmony)
        {
            var byEnumerator = AccessTools.Method(typeof(MonoBehaviour), nameof(MonoBehaviour.StartCoroutine), new[] { typeof(IEnumerator) })
                ?? throw new MissingMethodException("MonoBehaviour.StartCoroutine(IEnumerator) not found");
            // StartCoroutine(string) calls this one.
            var byName = AccessTools.Method(typeof(MonoBehaviour), nameof(MonoBehaviour.StartCoroutine), new[] { typeof(string), typeof(object) })
                ?? throw new MissingMethodException("MonoBehaviour.StartCoroutine(string, object) not found");
            harmony.Patch(byEnumerator, prefix: HookRegistry.Prefix(typeof(CoroutineCensusHook), nameof(EnumeratorPrefix)));
            harmony.Patch(byName, prefix: HookRegistry.Prefix(typeof(CoroutineCensusHook), nameof(ByNamePrefix)));
            _applied = true;
        }

        private static void EnumeratorPrefix(IEnumerator routine)
        {
            try
            {
                if (routine == null || !Recorder.IsMainThread)
                    return;
                var type = routine.GetType();
                if (SeenTypes.Add(type))
                {
                    _newTypes++;
                    if (type.IsGenericType)
                        _newGeneric++;
                    // Compiler-generated iterators are nested types named "<Method>d__N".
                    if (!type.Name.StartsWith("<", StringComparison.Ordinal))
                        _newCustom++;
                }
                Count(TypeKeys.Of(type));
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
                var key = $"{TypeKeys.Of(__instance.GetType())}.{methodName} (by name)";
                if (SeenByName.Add(key))
                    _newByName++;
                Count(key);
            }
            catch (Exception)
            {
                // Never break the game's method.
            }
        }

        private static void Count(string key)
        {
            SinceCheckpoint.TryGetValue(key, out var s);
            s.Count++;
            SinceCheckpoint[key] = s;
        }

        /// <summary>Writes the starts since the previous checkpoint and the new types, then resets them.</summary>
        public static void EmitAll()
        {
            if (!_applied)
                return;
            foreach (var entry in SinceCheckpoint)
                Recorder.Aggregate("coroutine.start", entry.Key, entry.Value.Count, 0, 0);
            SinceCheckpoint.Clear();
            Recorder.Counter("coroutine.types.new", _newTypes);
            Recorder.Counter("coroutine.types.new.generic", _newGeneric);
            Recorder.Counter("coroutine.types.new.custom", _newCustom);
            Recorder.Counter("coroutine.byName.new", _newByName);
            Recorder.Counter("coroutine.types.seen", SeenTypes.Count + SeenByName.Count);
            _newTypes = _newGeneric = _newCustom = _newByName = 0;
        }
    }
}
