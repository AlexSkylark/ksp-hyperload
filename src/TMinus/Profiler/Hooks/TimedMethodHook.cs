using System;
using System.Collections.Generic;
using System.Reflection;
using HarmonyLib;
using UnityEngine;

namespace TMinus.Profiler.Hooks
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

        /// <summary>As <see cref="Sink"/>, with the instance the method ran on (null for static methods).</summary>
        public delegate void InstanceSink(long startTicks, long endTicks, object instance);

        // Copy-on-write: replaced while hooks are applied, read lock-free from any thread.
        private static Dictionary<RuntimeMethodHandle, InstanceSink> _sinks = new Dictionary<RuntimeMethodHandle, InstanceSink>();
        private static bool _sinkFailureLogged;

        private readonly Func<MethodBase> _target;
        private readonly InstanceSink _sink;

        public string Id { get; }
        public string Group { get; }

        /// <param name="target">Resolves the method to time; returns null if it does not exist.</param>
        public TimedMethodHook(string id, string group, Func<MethodBase> target, Sink sink)
            : this(id, group, target, (start, end, instance) => sink(start, end))
        {
        }

        /// <param name="target">Resolves the method to time; returns null if it does not exist.</param>
        public TimedMethodHook(string id, string group, Func<MethodBase> target, InstanceSink sink)
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

        /// <summary>
        /// Adds each call to <paramref name="aggregate"/> under a key computed from the
        /// instance (a module's type, a part's name). Calls on a null instance or whose
        /// key is null are not added.
        /// </summary>
        public static TimedMethodHook ByInstance(string id, string group, Func<MethodBase> target, TimingAggregate aggregate, Func<object, string> keyOf) =>
            new TimedMethodHook(id, group, target, (start, end, instance) =>
            {
                var key = instance == null ? null : keyOf(instance);
                if (key != null)
                    aggregate.Add(key, start, end);
            });

        /// <summary>The key of a type-keyed aggregate: the instance's runtime type (see <see cref="TypeKeys"/>).</summary>
        public static string TypeKey(object instance) => TypeKeys.Of(instance.GetType());

        public void Apply(Harmony harmony)
        {
            var method = _target() ?? throw new MissingMethodException("target method not found");

            _sinks = new Dictionary<RuntimeMethodHandle, InstanceSink>(_sinks) { [method.MethodHandle] = _sink };
            harmony.Patch(method,
                prefix: HookRegistry.Prefix(typeof(TimedMethodHook), nameof(Prefix)),
                postfix: HookRegistry.Postfix(typeof(TimedMethodHook), nameof(Postfix)));
        }

        private static void Prefix(out long __state) => __state = ProfilerClock.Now();

        private static void Postfix(long __state, MethodBase __originalMethod, object __instance)
        {
            var end = ProfilerClock.Now();
            try
            {
                FrameCoverage.Add(__state, end);
                if (_sinks.TryGetValue(__originalMethod.MethodHandle, out var sink))
                    sink(__state, end, __instance);
            }
            catch (Exception e)
            {
                // A profiler bug must never break the game's method.
                if (!_sinkFailureLogged)
                {
                    _sinkFailureLogged = true;
                    Debug.LogError($"[TMinus] Profiler: recording failed in {__originalMethod.Name} ({e.Message}); further failures are not logged");
                }
            }
        }
    }
}
