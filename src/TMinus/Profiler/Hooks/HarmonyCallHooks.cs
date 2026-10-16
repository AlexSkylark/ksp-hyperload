using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Reflection;
using System.Runtime.CompilerServices;
using System.Threading;
using HarmonyLib;
using TMinus.Profiler.Hooks.CallSlots;
using Debug = UnityEngine.Debug;

namespace TMinus.Profiler.Hooks
{
    /// <summary>
    /// DIAGNOSTIC, OFF BY DEFAULT. Per-call cost of other mods' Harmony patches
    /// (docs/m5-profiler-plan.md, "Step 4b"). Every method another mod patches with
    /// a prefix, postfix or finalizer gets two brackets around all of its patches:
    /// <code>
    /// outer prefix (int.MaxValue), mods' prefixes, inner prefix (int.MinValue),
    ///   original body (transpilers included),
    /// inner postfix (int.MaxValue), mods' void postfixes, outer postfix (int.MinValue)
    /// </code>
    /// Outer minus inner is the time the mods' patches add to each call; inner is the
    /// body. Totals are raw: the brackets' own cost per call is measured once
    /// (calibration) and recorded separately for the analyzer to subtract.
    /// <para>
    /// Each bracketed method gets a slot of generated stub classes
    /// (<c>HarmonyCallSlots.g.cs</c>), so a call only reads the clock and adds to its
    /// slot's counters. The outer end is a void postfix, not a finalizer: a finalizer
    /// would wrap the method in try/catch. Calls that throw are therefore not
    /// counted, and other mods' finalizers and pass-through postfixes run after the
    /// outer postfix (those methods are listed as partial).
    /// </para>
    /// <para>
    /// Methods are found through <see cref="HarmonyHooks"/> (required) and bracketed
    /// later, from <see cref="ProfilerHost"/>'s Update, within a time budget per
    /// frame: never under Harmony's lock. Methods that T-Minus' own timing hooks
    /// patch are skipped: those prefixes would fall inside the outer window.
    /// Bracketing changes how a method is compiled, so only methods that other mods
    /// already patch are bracketed.
    /// </para>
    /// </summary>
    internal sealed class HarmonyCallHooks : IProfilerHook
    {
        public const string GroupName = "harmonyCallHooks";
        public const string HarmonyId = ProfilerHost.HarmonyId + ".Calls";

        private const int CalibrationSlot = 0;
        private const int CalibrationCalls = 20000;
        private const int CalibrationBatches = 3;
        /// <summary>Methods written per checkpoint, by patch time; the rest go into one "(other)" line.</summary>
        private const int TopN = 100;
        /// <summary>Bracketing time per frame (each method is two rebuilds).</summary>
        private static readonly long BudgetTicks = Stopwatch.Frequency / 100;

        // Per slot, since the last checkpoint. Written with Interlocked from any thread.
        private static readonly long[] Calls = new long[Pool.Size];
        private static readonly long[] OuterTicks = new long[Pool.Size];
        private static readonly long[] InnerTicks = new long[Pool.Size];

        // Everything below is guarded by Sync.
        private static readonly object Sync = new object();
        private static readonly Dictionary<MethodBase, int> SlotOf = new Dictionary<MethodBase, int>();
        private static readonly string[] KeyOf = new string[Pool.Size];
        /// <summary>Why a bracketed method stopped counting (T-Minus patched it later, bracketing failed).</summary>
        private static readonly string[] ExcludedWhy = new string[Pool.Size];
        /// <summary>Bracketed methods whose other patches include finalizers or pass-through postfixes.</summary>
        private static readonly bool[] Partial = new bool[Pool.Size];
        private static readonly Queue<MethodBase> Pending = new Queue<MethodBase>();
        private static readonly HashSet<MethodBase> PendingSet = new HashSet<MethodBase>();        /// <summary>Methods patched by others but not bracketed, with the reason.</summary>
        private static readonly Dictionary<MethodBase, string> Skipped = new Dictionary<MethodBase, string>();
        private static int _nextSlot = CalibrationSlot + 1;

        private static Harmony _harmony;
        private static volatile bool _active;
        /// <summary>While Apply reads the methods patched so far (before <see cref="_active"/>).</summary>
        private static bool _seeding;
        private static bool _failureLogged;

        public string Id => "harmony.calls";
        public string Group => GroupName;

        public void Apply(Harmony harmony)
        {
            if (!HarmonyHooks.Applied)
                throw new InvalidOperationException($"requires {HarmonyHooks.GroupName}");

            _harmony = new Harmony(HarmonyId);
            Calibrate();

            // Methods patched before now: T-Minus' own hooks, and anything patched before HarmonyHooks.
            _seeding = true;
            foreach (var method in Harmony.GetAllPatchedMethods().ToList())
            {
                var info = Harmony.GetPatchInfo(method);
                if (info != null)
                    Observe(method, info.Prefixes, info.Postfixes, info.Transpilers, info.Finalizers, resolved: false);
            }
            _seeding = false;
            _active = true;
        }

        // Empty and never inlined: a call that only crosses the brackets.
        [MethodImpl(MethodImplOptions.NoInlining)]
        private static void CalibrationTarget()
        {
        }

        /// <summary>
        /// The brackets' own cost per call, inside each window: the clock reads and
        /// counter updates of an empty method. Minimum over a few batches.
        /// </summary>
        private static void Calibrate()
        {
            Bracket(AccessTools.Method(typeof(HarmonyCallHooks), nameof(CalibrationTarget)), CalibrationSlot);
            double patches = double.MaxValue, body = double.MaxValue;
            for (var batch = 0; batch < CalibrationBatches; batch++)
            {
                Take(CalibrationSlot, out _, out _, out _);
                for (var i = 0; i < CalibrationCalls; i++)
                    CalibrationTarget();
                Take(CalibrationSlot, out var calls, out var outer, out var inner);
                if (calls == 0)
                    throw new InvalidOperationException("calibration target not bracketed (inlined?)");
                patches = Math.Min(patches, Nanoseconds(outer - inner) / calls);
                body = Math.Min(body, Nanoseconds(inner) / calls);
            }

            var detail = $"ns per call, minimum of {CalibrationBatches} batches of {CalibrationCalls} calls";
            Recorder.Counter("harmony.call.calibration.patches", patches, detail);
            Recorder.Counter("harmony.call.calibration.body", body, detail);
        }

        private static double Nanoseconds(long ticks) => ticks * 1e9 / Stopwatch.Frequency;

        // Called by the generated stubs on every call: keep these minimal.
        public static void Outer(int slot, long start)
        {
            if (start == 0)
                return;
            Interlocked.Add(ref OuterTicks[slot], ProfilerClock.Now() - start);
            Interlocked.Increment(ref Calls[slot]);
        }

        public static void Inner(int slot, long start)
        {
            if (start == 0)
                return;
            Interlocked.Add(ref InnerTicks[slot], ProfilerClock.Now() - start);
        }

        private static void Take(int slot, out long calls, out long outer, out long inner)
        {
            calls = Interlocked.Exchange(ref Calls[slot], 0);
            outer = Interlocked.Exchange(ref OuterTicks[slot], 0);
            inner = Interlocked.Exchange(ref InnerTicks[slot], 0);
        }

        /// <summary>
        /// A method's patches changed (from <see cref="HarmonyHooks"/>, under Harmony's
        /// lock): queue it if it should be bracketed. Reads only.
        /// </summary>
        /// <param name="resolved">True when Harmony has just resolved the patch methods (then they are cheap to read).</param>
        public static void Observe(MethodBase original, IEnumerable<Patch> prefixes, IEnumerable<Patch> postfixes,
            IEnumerable<Patch> transpilers, IEnumerable<Patch> finalizers, bool resolved)
        {
            if (original == null || !(_active || _seeding))
                return;

            bool Other(Patch p) => p.owner != ProfilerHost.HarmonyId && p.owner != HarmonyId;
            var own = prefixes.Concat(postfixes).Concat(transpilers).Concat(finalizers).Any(p => p.owner == ProfilerHost.HarmonyId);
            var timed = prefixes.Any(Other) || postfixes.Any(Other) || finalizers.Any(Other);
            if (!timed && !transpilers.Any(Other))
                return;
            var partial = finalizers.Any(Other) || (resolved && postfixes.Any(p => Other(p) && p.PatchMethod?.ReturnType != typeof(void)));

            lock (Sync)
            {
                if (SlotOf.TryGetValue(original, out var slot))
                {
                    if (own && ExcludedWhy[slot] == null)
                        ExcludedWhy[slot] = "own";
                    Partial[slot] |= partial;
                    return;
                }
                if (PendingSet.Contains(original))
                    return;

                string why = null;
                if (own)
                    why = "own";
                else if (!timed)
                    why = "transpiler-only";
                else if (original is ConstructorInfo c && c.IsStatic)
                    why = "static-constructor";
                else if (original.ContainsGenericParameters)
                    why = "generic";
                else if (_nextSlot + Pending.Count >= Pool.Size)
                    why = "pool-full";

                if (why != null)
                {
                    Skipped[original] = why;
                    return;
                }

                Skipped.Remove(original);
                Pending.Enqueue(original);
                PendingSet.Add(original);
                if (partial)
                    PartialPending.Add(original);
            }
        }

        private static readonly HashSet<MethodBase> PartialPending = new HashSet<MethodBase>();

        /// <summary>Brackets queued methods, within the frame budget. Main thread, from ProfilerHost.Update.</summary>
        public static void ApplyPending()
        {
            if (!_active)
                return;

            var start = ProfilerClock.Now();
            while (ProfilerClock.Now() - start < BudgetTicks)
            {
                MethodBase method;
                int slot;
                lock (Sync)
                {
                    if (Pending.Count == 0)
                        return;
                    method = Pending.Dequeue();
                    PendingSet.Remove(method);
                    slot = _nextSlot++;
                    SlotOf[method] = slot;
                    KeyOf[slot] = HarmonyHooks.MethodKey(method);
                    Partial[slot] = PartialPending.Remove(method);
                }

                // Outside Sync: patching takes Harmony's lock, whose rebuild calls Observe.
                try
                {
                    Bracket(method, slot);
                    var owners = Harmony.GetPatchInfo(method)?.Owners.Where(o => o != ProfilerHost.HarmonyId && o != HarmonyId).OrderBy(o => o, StringComparer.Ordinal);
                    Recorder.Mark("harmony.call.bracket", $"{KeyOf[slot]}: {string.Join(",", owners ?? Enumerable.Empty<string>())}");
                }
                catch (Exception e)
                {
                    lock (Sync)
                        ExcludedWhy[slot] = "failed";
                    Recorder.Mark("harmony.call.failed", $"{KeyOf[slot]}: {e.GetType().Name}: {e.Message}");
                    try
                    {
                        _harmony.Unpatch(method, HarmonyPatchType.All, HarmonyId);
                    }
                    catch (Exception)
                    {
                        // Its counters are already excluded.
                    }
                    if (!_failureLogged)
                    {
                        _failureLogged = true;
                        Debug.LogWarning($"[TMinus] Profiler: could not bracket {KeyOf[slot]} ({e.GetType().Name}: {e.Message}); further failures are only recorded");
                    }
                }
            }
        }

        /// <summary>
        /// Two rebuilds: the inner pair first, so calls in between count body time
        /// without a call (harmless), never an outer window around nothing.
        /// </summary>
        private static void Bracket(MethodBase method, int slot)
        {
            HarmonyMethod Fix(Type type, string name, int priority) =>
                new HarmonyMethod(AccessTools.Method(type, name)) { priority = priority };

            _harmony.Patch(method,
                prefix: Fix(Pool.Inner(slot), "Prefix", int.MinValue),
                postfix: Fix(Pool.Inner(slot), "Postfix", int.MaxValue));
            _harmony.Patch(method,
                prefix: Fix(Pool.Outer(slot), "Prefix", int.MaxValue),
                postfix: Fix(Pool.Outer(slot), "Postfix", int.MinValue));
        }

        /// <summary>At each checkpoint: the calls since the previous one, per method, then the coverage counters.</summary>
        public static void EmitAll()
        {
            if (!_active)
                return;

            var rows = new List<(string key, long calls, long patches, long body)>();
            int bracketed, excluded = 0;
            var partial = new List<string>();
            Dictionary<string, int> skipped;
            lock (Sync)
            {
                bracketed = _nextSlot - 1 - CalibrationSlot;
                for (var slot = CalibrationSlot + 1; slot < _nextSlot; slot++)
                {
                    Take(slot, out var calls, out var outer, out var inner);
                    if (ExcludedWhy[slot] != null)
                    {
                        excluded++;
                        continue;
                    }
                    if (Partial[slot])
                        partial.Add(KeyOf[slot]);
                    if (calls > 0)
                        rows.Add((KeyOf[slot], calls, outer - inner, inner));
                }
                skipped = Skipped.Values.GroupBy(v => v).ToDictionary(g => g.Key, g => g.Count());
                foreach (var why in ExcludedWhy.Where(w => w != null))
                    skipped[$"excluded-{why}"] = (skipped.TryGetValue($"excluded-{why}", out var n) ? n : 0) + 1;
            }

            // Max per call is not tracked (it would cost a compare-and-swap per call): written as 0.
            var ordered = rows.OrderByDescending(r => r.patches).ToList();
            foreach (var r in ordered.Take(TopN))
            {
                Recorder.Aggregate("harmony.call.patches", r.key, r.calls, r.patches, 0);
                Recorder.Aggregate("harmony.call.body", r.key, r.calls, r.body, 0);
            }
            if (ordered.Count > TopN)
            {
                var rest = ordered.Skip(TopN).ToList();
                var key = $"(other {rest.Count} keys)";
                Recorder.Aggregate("harmony.call.patches", key, rest.Sum(r => r.calls), rest.Sum(r => r.patches), 0);
                Recorder.Aggregate("harmony.call.body", key, rest.Sum(r => r.calls), rest.Sum(r => r.body), 0);
            }

            Recorder.Counter("harmony.call.bracketed", bracketed - excluded);
            Recorder.Counter("harmony.call.skipped", skipped.Values.Sum(),
                string.Join(",", skipped.OrderBy(e => e.Key, StringComparer.Ordinal).Select(e => $"{e.Key}={e.Value}")));
            if (partial.Count > 0)
                Recorder.Counter("harmony.call.partial", partial.Count, string.Join(",", partial));
        }
    }
}
