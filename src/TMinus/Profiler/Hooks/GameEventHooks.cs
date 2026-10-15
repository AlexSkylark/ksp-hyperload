using System;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using HarmonyLib;

namespace TMinus.Profiler.Hooks
{
    /// <summary>
    /// Total time spent in each GameEvent dispatch (<c>EventVoid.Fire</c>,
    /// <c>EventData&lt;...&gt;.Fire</c>): the handlers that mods subscribe run
    /// synchronously inside it. Mods often do heavy work in handlers rather than
    /// in their own Start, where no other hook sees it.
    /// <para>
    /// Only per-event totals: timing each handler would mean replacing KSP's
    /// Fire method (not level 0). Events fired from inside handlers are counted
    /// in both.
    /// </para>
    /// <para>
    /// Mono shares one compiled method between all instantiations whose type
    /// arguments are reference types, so patching <c>EventData&lt;object&gt;.Fire</c>
    /// covers every <c>EventData&lt;SomeClass&gt;</c>; value-type instantiations
    /// (<c>EventData&lt;GameScenes&gt;</c>, ...) are patched one by one. KSPCF's
    /// EventProfilerMarkers relies on the same sharing (MIT, KSPCommunityFixes 1.41.1).
    /// The instantiations are taken from the events KSP declares in
    /// <c>GameEvents</c>; value-type events that only mods declare are not covered.
    /// </para>
    /// </summary>
    internal sealed class GameEventHooks : IProfilerHook
    {
        /// <summary>Single dispatches slower than this are also recorded as spans, to place them on the timeline.</summary>
        private const double SlowMs = 50;

        private static readonly TimingAggregate Totals = new TimingAggregate("gameEvent.fire", minTotalMs: 0.05);
        private static readonly long SlowTicks = (long)(SlowMs / 1000.0 * System.Diagnostics.Stopwatch.Frequency);

        public string Id => "gameEvent.fire";
        public string Group => "eventHooks";

        public void Apply(Harmony harmony)
        {
            var prefix = HookRegistry.Prefix(typeof(GameEventHooks), nameof(Prefix));
            var postfix = HookRegistry.Postfix(typeof(GameEventHooks), nameof(Postfix));

            var targets = new HashSet<MethodBase> { AccessTools.Method(typeof(EventVoid), nameof(EventVoid.Fire)) };
            foreach (var eventType in DeclaredEventTypes(typeof(GameEvents)))
            {
                var fire = AccessTools.Method(SharedInstantiation(eventType), "Fire");
                if (fire != null)
                    targets.Add(fire);
            }

            int patched = 0;
            string firstFailure = null;
            foreach (var target in targets)
            {
                try
                {
                    harmony.Patch(target, prefix: prefix, postfix: postfix);
                    patched++;
                }
                catch (Exception e)
                {
                    if (firstFailure == null)
                        firstFailure = $"{target.DeclaringType}: {e.Message}";
                }
            }

            Recorder.Counter("gameEvent.fire.patched", patched);
            if (patched == 0)
                throw new InvalidOperationException(firstFailure ?? "no Fire method found");
            if (firstFailure != null)
                UnityEngine.Debug.LogWarning($"[TMinus] Profiler: {targets.Count - patched} GameEvent Fire methods not hooked (first: {firstFailure})");
        }

        /// <summary>Generic EventData types of every static event field, including nested classes (GameEvents.Contract, ...).</summary>
        private static IEnumerable<Type> DeclaredEventTypes(Type holder)
        {
            foreach (var field in holder.GetFields(BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Static))
            {
                var type = field.FieldType;
                if (type.IsGenericType && typeof(BaseGameEvent).IsAssignableFrom(type))
                    yield return type;
            }
            foreach (var nested in holder.GetNestedTypes(BindingFlags.Public | BindingFlags.NonPublic))
                foreach (var type in DeclaredEventTypes(nested))
                    yield return type;
        }

        /// <summary>The instantiation whose code Mono shares: reference-type arguments become object.</summary>
        private static Type SharedInstantiation(Type eventType)
        {
            var args = eventType.GetGenericArguments().Select(a => a.IsValueType ? a : typeof(object)).ToArray();
            return eventType.GetGenericTypeDefinition().MakeGenericType(args);
        }

        private static void Prefix(out long __state) => __state = ProfilerClock.Now();

        private static void Postfix(long __state, object __instance)
        {
            var end = ProfilerClock.Now();
            try
            {
                var name = (__instance as BaseGameEvent)?.EventName ?? "(unknown)";
                Totals.Add(name, __state, end);
                if (end - __state >= SlowTicks)
                    Recorder.Span("gameEvent.slow", __state, end, name);
            }
            catch (Exception)
            {
                // Never break the game's method.
            }
        }
    }
}
