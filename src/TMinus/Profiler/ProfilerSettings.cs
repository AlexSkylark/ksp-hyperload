using System;
using System.Collections.Generic;
using System.IO;
using UnityEngine;

namespace TMinus.Profiler
{
    /// <summary>
    /// Profiler settings from <c>GameData/000_TMinus/PluginData/Settings.cfg</c>,
    /// node <c>TMINUS_PROFILER</c>. Read directly from disk at startup, before
    /// GameDatabase exists, so ModuleManager patches do not apply to it. It lives in
    /// PluginData so that GameDatabase (and therefore ModuleManager's cache hash)
    /// never sees it: changing a profiler setting must not turn the next run into an
    /// MM cold start.
    /// </summary>
    internal sealed class ProfilerSettings
    {
        public const string NodeName = "TMINUS_PROFILER";

        private readonly ConfigNode _node;

        /// <summary>Master switch. When false, T-Minus applies no hooks and records nothing.</summary>
        public bool Enabled { get; }

        private ProfilerSettings(ConfigNode node)
        {
            _node = node;
            var enabled = true;
            node?.TryGetValue("enabled", ref enabled);
            Enabled = enabled;
        }

        /// <summary>
        /// Groups that change what the game does (however slightly) or cost time at a
        /// measured moment: off unless the settings file turns them on, even when the
        /// file is missing.
        /// </summary>
        private static readonly HashSet<string> OffByDefault = new HashSet<string> { "addonStartHooks", "patchInventory", "harmonyCallHooks", "coroutineCensus" };

        /// <summary>Hook groups are on unless the settings file sets them to false (see <see cref="OffByDefault"/>).</summary>
        public bool IsGroupEnabled(string group)
        {
            var enabled = !OffByDefault.Contains(group);
            _node?.TryGetValue(group, ref enabled);
            return enabled;
        }

        public static ProfilerSettings Load(string pluginDataDirectory)
        {
            var path = Path.Combine(pluginDataDirectory, "Settings.cfg");
            try
            {
                if (File.Exists(path))
                    return new ProfilerSettings(ConfigNode.Load(path)?.GetNode(NodeName));

                Debug.Log($"[TMinus] Profiler: no settings file at {path}, using defaults");
            }
            catch (Exception e)
            {
                Debug.LogWarning($"[TMinus] Profiler: could not read {path} ({e.Message}), using defaults");
            }

            return new ProfilerSettings(null);
        }
    }
}
