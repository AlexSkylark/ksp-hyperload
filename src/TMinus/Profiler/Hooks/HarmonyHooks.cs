using System;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using HarmonyLib;
using UnityEngine;

namespace TMinus.Profiler.Hooks
{
    /// <summary>
    /// The cost of applying Harmony patches, per mod (docs/m5-profiler-plan.md,
    /// "Harmony: cost of applying patches"). Every patch and unpatch ends in
    /// Harmony's internal <c>PatchFunctions.UpdateWrapper(original, patchInfo)</c>,
    /// which builds and JIT-compiles a replacement with all of the method's patches
    /// (every owner's) and detours the original to it; it never nests.
    /// <para>
    /// The owner is not passed in. Harmony stores a method's patches only after
    /// <c>UpdateWrapper</c> returns, so in the finalizer the stored list is still
    /// the old one: owners with more patches in <c>patchInfo</c> than before paid
    /// for the rebuild; with none, owners with fewer (an unpatch). Owners are
    /// compared by patch count, never by <see cref="Patch.PatchMethod"/>, which on
    /// a stored patch scans every loaded module. The patch method's assembly is
    /// read from <c>patchInfo</c>, whose patches Harmony has just resolved.
    /// </para>
    /// <para>
    /// Only the clock is read before the original runs; all the bookkeeping
    /// happens after. The hook only reads Harmony's state, never patches (it runs
    /// under Harmony's lock). <c>PatchFunctions</c> is an internal type of a mod
    /// assembly, already in use when the hook is applied; if a Harmony version
    /// changes it, the hook is unavailable and nothing is recorded.
    /// </para>
    /// </summary>
    internal sealed class HarmonyHooks : IProfilerHook
    {
        public const string GroupName = "harmonyHooks";

        private static readonly TimingAggregate PatchCost = new TimingAggregate("harmony.patch");
        private static readonly TimingAggregate UnpatchCost = new TimingAggregate("harmony.unpatch");
        private static readonly TimingAggregate TargetCost = new TimingAggregate("harmony.target", topN: 50);

        // Owner patch counts per method, as last seen by the hook. Guarded by itself.
        private static readonly Dictionary<MethodBase, Dictionary<string, int>> Seen = new Dictionary<MethodBase, Dictionary<string, int>>();
        // Assembly of each owner's patch methods, for unpatches.
        private static readonly Dictionary<string, string> AssemblyOfOwner = new Dictionary<string, string>();
        private static bool _failureLogged;

        /// <summary>True once the hook is in place: <see cref="HarmonyCallHooks"/> depends on it.</summary>
        public static bool Applied { get; private set; }

        public string Id => "harmony.updateWrapper";
        public string Group => GroupName;

        public void Apply(Harmony harmony)
        {
            var type = AccessTools.TypeByName("HarmonyLib.PatchFunctions")
                ?? throw new MissingMemberException("HarmonyLib.PatchFunctions");
            var updateWrapper = AccessTools.Method(type, "UpdateWrapper", new[] { typeof(MethodBase), typeof(PatchInfo) })
                ?? throw new MissingMethodException("PatchFunctions.UpdateWrapper(MethodBase, PatchInfo)");

            // Patches applied before this hook: their owners are not timed.
            var before = Harmony.GetAllPatchedMethods().ToList();
            var owners = new SortedSet<string>(StringComparer.Ordinal);
            foreach (var method in before)
            {
                var info = Harmony.GetPatchInfo(method);
                if (info != null)
                    owners.UnionWith(info.Owners);
            }
            Recorder.Counter("harmony.before", before.Count, string.Join(",", owners));

            harmony.Patch(updateWrapper,
                prefix: HookRegistry.Prefix(typeof(HarmonyHooks), nameof(Prefix)),
                finalizer: new HarmonyMethod(AccessTools.Method(typeof(HarmonyHooks), nameof(Finalizer))) { priority = Priority.Last });
            Applied = true;
        }

        private static void Prefix(out long __state) => __state = ProfilerClock.Now();

        // Parameter names must match UpdateWrapper(original, patchInfo). Void: Harmony rethrows __exception.
        private static void Finalizer(long __state, Exception __exception, MethodBase original, PatchInfo patchInfo)
        {
            var end = ProfilerClock.Now();
            try
            {
                if (original == null || patchInfo == null)
                    return;
                var now = Counts(patchInfo);
                Dictionary<string, int> old;
                lock (Seen)
                {
                    if (!Seen.TryGetValue(original, out old))
                        old = Counts(Harmony.GetPatchInfo(original));
                    // A failed rebuild leaves the stored patches unchanged.
                    if (__exception == null)
                        Seen[original] = now;
                }

                var added = now.Where(e => e.Value > (old.TryGetValue(e.Key, out var n) ? n : 0)).Select(e => e.Key).ToList();
                var removed = old.Where(e => e.Value > (now.TryGetValue(e.Key, out var n) ? n : 0)).Select(e => e.Key).ToList();
                var unpatch = added.Count == 0;
                var owner = unpatch ? removed.FirstOrDefault() : added[0];
                var key = owner == null ? "unknown" : OwnerKey(owner, patchInfo);

                (unpatch ? UnpatchCost : PatchCost).Add(key, __state, end);
                TargetCost.Add(MethodKey(original), __state, end, coversFrame: false);
                if (__exception != null)
                    Recorder.Mark("harmony.patch.failed", $"{key}: {MethodKey(original)}");
                else
                    HarmonyCallHooks.Observe(original, patchInfo.prefixes, patchInfo.postfixes, patchInfo.transpilers, patchInfo.finalizers, resolved: true);
            }
            catch (Exception e)
            {
                // A profiler bug must never break the mod's patching.
                if (!_failureLogged)
                {
                    _failureLogged = true;
                    Debug.LogError($"[TMinus] Profiler: Harmony patch timing failed ({e.Message}); further failures are not logged");
                }
            }
        }

        private static Dictionary<string, int> Counts(PatchInfo info)
        {
            var counts = new Dictionary<string, int>(StringComparer.Ordinal);
            if (info != null)
                foreach (var list in new[] { info.prefixes, info.postfixes, info.transpilers, info.finalizers })
                    Count(counts, list);
            return counts;
        }

        private static Dictionary<string, int> Counts(Patches patches)
        {
            var counts = new Dictionary<string, int>(StringComparer.Ordinal);
            if (patches != null)
                foreach (var list in new[] { patches.Prefixes, patches.Postfixes, patches.Transpilers, patches.Finalizers })
                    Count(counts, list);
            return counts;
        }

        private static void Count(Dictionary<string, int> counts, IEnumerable<Patch> patches)
        {
            foreach (var p in patches)
                counts[p.owner] = (counts.TryGetValue(p.owner, out var n) ? n : 0) + 1;
        }

        /// <summary>The assembly of the owner's patch methods: from <paramref name="patches"/> when it has them, else as last seen.</summary>
        private static string AssemblyOf(string owner, IEnumerable<Patch> patches)
        {
            lock (AssemblyOfOwner)
            {
                var patch = patches.FirstOrDefault(p => p.owner == owner);
                var assembly = patch?.PatchMethod?.DeclaringType?.Assembly.GetName().Name;
                if (assembly != null)
                    AssemblyOfOwner[owner] = assembly;
                else if (!AssemblyOfOwner.TryGetValue(owner, out assembly))
                    assembly = "unknown";
                return assembly;
            }
        }

        /// <summary>An owner as recorded: <c>&lt;assembly&gt;/&lt;Harmony id&gt;</c>.</summary>
        internal static string OwnerKey(string owner, PatchInfo info) =>
            $"{AssemblyOf(owner, new[] { info.prefixes, info.postfixes, info.transpilers, info.finalizers }.SelectMany(l => l))}/{owner}";

        internal static string OwnerKey(string owner, Patches info) =>
            $"{AssemblyOf(owner, new[] { info.Prefixes, info.Postfixes, info.Transpilers, info.Finalizers }.SelectMany(l => l))}/{owner}";

        internal static string MethodKey(MethodBase method) =>
            method.DeclaringType == null ? method.Name : $"{TypeKeys.Of(method.DeclaringType)}.{method.Name}";
    }
}
