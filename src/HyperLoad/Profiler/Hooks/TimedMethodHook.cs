using System;
using System.Collections.Generic;
using System.Reflection;
using HarmonyLib;
using UnityEngine;

namespace HyperLoad.Profiler.Hooks
{
    /// <summary>
    /// Times every call of one method with a prefix/postfix pair and hands the
    /// (start, end) ticks to a sink: record a span, or add to an aggregate.
    /// <para>
    /// The prefix only takes <c>__state</c>, so it still runs when another mod's
    /// prefix skips the original (KSPCF replaces several methods that way); the
    /// postfix always runs unless the method throws. The time measured is
    /// whatever actually ran, stock or replacement.
    /// </para>
    /// </summary>
    internal sealed class TimedMethodHook : IProfilerHook
    {
        /// <summary>Receives the start and end ticks of one call. Runs on the calling thread.</summary>
        public delegate void Sink(long startTicks, long endTicks);

        // Copy-on-write: replaced while hooks are applied, read lock-free from any thread.
        private static Dictionary<RuntimeMethodHandle, Sink> _sinks = new Dictionary<RuntimeMethodHandle, Sink>();
        private static bool _sinkFailureLogged;

        private readonly Func<MethodBase> _target;
        private readonly Sink _sink;

        public string Id { get; }
        public string Group { get; }

        /// <param name="target">Resolves the method to time; returns null if it does not exist.</param>
        public TimedMethodHook(string id, string group, Func<MethodBase> target, Sink sink)
        {
            Id = id;
            Group = group;
            _target = target;
            _sink = sink;
        }

        /// <summary>Records each call as a span named <paramref name="spanName"/>.</summary>
        public static TimedMethodHook Span(string id, string group, Func<MethodBase> target, string spanName) =>
            new TimedMethodHook(id, group, target, (start, end) => Recorder.Span(spanName, start, end));

        /// <summary>
        /// Adds each call to <paramref name="aggregate"/> under <paramref name="key"/>,
        /// or under the calling thread ("main" / "background") when key is null.
        /// </summary>
        public static TimedMethodHook Aggregated(string id, string group, Func<MethodBase> target, TimingAggregate aggregate, string key = null) =>
            new TimedMethodHook(id, group, target,
                (start, end) => aggregate.Add(key ?? (Recorder.IsMainThread ? "main" : "background"), start, end));

        public void Apply(Harmony harmony)
        {
            var method = _target() ?? throw new MissingMethodException("target method not found");

            _sinks = new Dictionary<RuntimeMethodHandle, Sink>(_sinks) { [method.MethodHandle] = _sink };
            harmony.Patch(method,
                prefix: HookRegistry.Prefix(typeof(TimedMethodHook), nameof(Prefix)),
                postfix: HookRegistry.Postfix(typeof(TimedMethodHook), nameof(Postfix)));
        }

        private static void Prefix(out long __state) => __state = ProfilerClock.Now();

        private static void Postfix(long __state, MethodBase __originalMethod)
        {
            var end = ProfilerClock.Now();
            try
            {
                if (_sinks.TryGetValue(__originalMethod.MethodHandle, out var sink))
                    sink(__state, end);
            }
            catch (Exception e)
            {
                // A profiler bug must never break the game's method.
                if (!_sinkFailureLogged)
                {
                    _sinkFailureLogged = true;
                    Debug.LogError($"[HyperLoad] Profiler: recording failed in {__originalMethod.Name} ({e.Message}); further failures are not logged");
                }
            }
        }
    }
}
