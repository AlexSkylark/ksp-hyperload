using System;
using System.Collections.Generic;
using System.Linq;
using HarmonyLib;

namespace TMinus.Profiler
{
    /// <summary>
    /// KSPCommunityFixes' settings as the game uses them, against the installed
    /// Settings.cfg. KSPCF reads its settings from the game database after
    /// ModuleManager has patched it, so another mod can change a setting without
    /// touching the file (docs/mechanisms.md, 2.2). KSP.log shows each patch's
    /// state but not which setting a patch changed; this records the values.
    /// <para>
    /// Read only, once, at the main menu. Generic over KSPCF's keys: no list of
    /// keys or defaults is kept here.
    /// </para>
    /// </summary>
    internal sealed class KspcfSettings
    {
        private const string NodeName = "KSP_COMMUNITY_FIXES";

        private static KspcfSettings _cached;

        /// <summary>Settings nodes in the game database (KSPCF only reads them when there is exactly one).</summary>
        public int Nodes { get; private set; }

        /// <summary>"Key: installed -> effective", "+Key = effective" (added), "-Key" (removed); nested keys as "NODE/Key".</summary>
        public List<string> Changes { get; } = new List<string>();

        public static KspcfSettings Get()
        {
            if (_cached != null)
                return _cached;

            var result = new KspcfSettings();
            try
            {
                var configs = GameDatabase.Instance.GetConfigs(NodeName);
                result.Nodes = configs.Length;
                if (configs.Length == 1)
                {
                    var installed = ConfigNode.Load(configs[0].parent.fullPath)?.GetNode(NodeName);
                    if (installed != null)
                        Compare(installed, configs[0].config, "", result.Changes);
                }
            }
            catch (Exception)
            {
                // Unknown: record nothing rather than guess.
                result.Changes.Clear();
            }

            return _cached = result;
        }

        private static void Compare(ConfigNode installed, ConfigNode effective, string prefix, List<string> changes)
        {
            foreach (ConfigNode.Value value in installed.values)
            {
                var now = effective.GetValue(value.name);
                if (now == null)
                    changes.Add($"-{prefix}{value.name}");
                else if (now != value.value)
                    changes.Add($"{prefix}{value.name}: {value.value} -> {now}");
            }
            foreach (ConfigNode.Value value in effective.values)
            {
                if (!installed.HasValue(value.name))
                    changes.Add($"+{prefix}{value.name} = {value.value}");
            }
            foreach (ConfigNode node in installed.nodes)
            {
                var other = effective.GetNode(node.name);
                if (other == null)
                    changes.Add($"-{prefix}{node.name}");
                else
                    Compare(node, other, $"{prefix}{node.name}/", changes);
            }
        }
    }

    /// <summary>
    /// Every method Harmony has patched, with the owners (Harmony ids) of its
    /// patches: context for the report, not a finding (docs/mechanisms.md, 7.4).
    /// Uses only Harmony's public read-only API. Reading each method's patches
    /// costs time at the main menu, so the group is off by default.
    /// </summary>
    internal static class PatchInventory
    {
        public const string Group = "patchInventory";

        public static void Write(JsonLine j)
        {
            var methods = new List<string>();
            foreach (var method in Harmony.GetAllPatchedMethods())
            {
                var info = Harmony.GetPatchInfo(method);
                if (info == null || info.Owners.Count == 0)
                    continue;
                methods.Add($"{method.DeclaringType?.FullName}.{method.Name}: {string.Join(",", info.Owners.OrderBy(o => o))}");
            }
            methods.Sort(StringComparer.Ordinal);

            j.Field("kind", "patches")
                .Field("t", ProfilerClock.ToMsSinceProcessStart(ProfilerClock.Now()))
                .Field("count", methods.Count)
                .Field("methods", methods);
        }
    }
}
