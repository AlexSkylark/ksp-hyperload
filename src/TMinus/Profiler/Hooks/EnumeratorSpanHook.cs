using System;
using System.Collections.Generic;
using System.Reflection;
using System.Runtime.CompilerServices;
using HarmonyLib;
using UnityEngine;

namespace TMinus.Profiler.Hooks
{
    /// <summary>
    /// Times a coroutine from its first step to its last: a prefix on the
    /// enumerator's <c>MoveNext</c> notes the first call per enumerator, and the
    /// postfix adds the span when <c>MoveNext</c> returns false.
    /// <para>
    /// The span is wall time and includes the frames the coroutine waits, and any
    /// nested coroutine it waits for. Summing the steps instead would miss work that
    /// runs in nested coroutines (stock drag cubes, KSPCF's DragCubeGeneration).
    /// An enumerator that throws or is abandoned is never added; its start is
    /// dropped with the enumerator (weak table).
    /// </para>
    /// </summary>
    internal sealed class EnumeratorSpanHook : IProfilerHook
    {
        private sealed class Start
        {
            public long Ticks;
        }

        private static readonly ConditionalWeakTable<object, Start> Starts = new ConditionalWeakTable<object, Start>();
        // Copy-on-write, as in TimedMethodHook.
        private static Dictionary<RuntimeMethodHandle, TimedMethodHook.Sink> _sinks = new Dictionary<RuntimeMethodHandle, TimedMethodHook.Sink>();
        private static bool _sinkFailureLogged;

        private readonly Func<MethodBase> _coroutine;
        private readonly TimedMethodHook.Sink _sink;

        public string Id { get; }
        public string Group { get; }

        /// <param name="coroutine">Resolves the coroutine method (not its MoveNext); null if it does not exist.</param>
        public EnumeratorSpanHook(string id, string group, Func<MethodBase> coroutine, TimingAggregate aggregate, string key)
        {
            Id = id;
            Group = group;
            _coroutine = coroutine;
            _sink = (start, end) => aggregate.Add(key, start, end, coversFrame: false);
        }

        public void Apply(Harmony harmony)
        {
            var coroutine = _coroutine() ?? throw new MissingMethodException("coroutine not found");
            var moveNext = AccessTools.EnumeratorMoveNext(coroutine) ?? throw new MissingMethodException("MoveNext not found");

            _sinks = new Dictionary<RuntimeMethodHandle, TimedMethodHook.Sink>(_sinks) { [moveNext.MethodHandle] = _sink };
            harmony.Patch(moveNext,
                prefix: HookRegistry.Prefix(typeof(EnumeratorSpanHook), nameof(Prefix)),
                postfix: HookRegistry.Postfix(typeof(EnumeratorSpanHook), nameof(Postfix)));
        }

        private static void Prefix(object __instance)
        {
            try
            {
                if (!Starts.TryGetValue(__instance, out _))
                    Starts.Add(__instance, new Start { Ticks = ProfilerClock.Now() });
            }
            catch (Exception)
            {
                // Never break the game's method.
            }
        }

        private static void Postfix(object __instance, bool __result, MethodBase __originalMethod)
        {
            if (__result)
                return;

            var end = ProfilerClock.Now();
            try
            {
                if (!Starts.TryGetValue(__instance, out var start))
                    return;
                Starts.Remove(__instance);
                if (_sinks.TryGetValue(__originalMethod.MethodHandle, out var sink))
                    sink(start.Ticks, end);
            }
            catch (Exception e)
            {
                if (!_sinkFailureLogged)
                {
                    _sinkFailureLogged = true;
                    Debug.LogError($"[TMinus] Profiler: recording failed in {__originalMethod.Name} ({e.Message}); further failures are not logged");
                }
            }
        }
    }
}
