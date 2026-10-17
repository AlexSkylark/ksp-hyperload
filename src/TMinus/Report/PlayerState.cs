using System;
using System.IO;
using UnityEngine;

namespace TMinus.Report
{
    /// <summary>
    /// What the player chose in game: <c>PluginData/State.cfg</c>, node
    /// <c>TMINUS_STATE</c>. Apart from the shipped Settings.cfg, which an update
    /// overwrites; written only when the player turns measuring on or off from the
    /// T-Minus button (docs/m6-web-plan.md, "Measuring on and off"). Read once, at
    /// startup: a change applies from the next startup, because the profiler's
    /// hooks go in before the game loads anything.
    /// </summary>
    internal sealed class PlayerState
    {
        public const string NodeName = "TMINUS_STATE";

        private readonly string _path;

        /// <summary>Whether the next startup measures. On when the file is missing or unreadable.</summary>
        public bool Measuring { get; private set; }

        private PlayerState(string path, bool measuring)
        {
            _path = path;
            Measuring = measuring;
        }

        public static PlayerState Load(string pluginDataDirectory)
        {
            var path = Path.Combine(pluginDataDirectory, "State.cfg");
            var measuring = true;
            try
            {
                if (File.Exists(path))
                    ConfigNode.Load(path)?.GetNode(NodeName)?.TryGetValue("measuring", ref measuring);
            }
            catch (Exception e)
            {
                Debug.LogWarning($"[TMinus] Could not read {path} ({e.Message}), measuring stays on");
            }
            return new PlayerState(path, measuring);
        }

        /// <summary>Saves the choice for the next startup; false when the file cannot be written.</summary>
        public bool Save(bool measuring)
        {
            try
            {
                Directory.CreateDirectory(Path.GetDirectoryName(_path));
                File.WriteAllText(_path,
                    "// Written by T-Minus when you turn measuring on or off from its toolbar button.\n"
                    + "// Read at startup. Deleting this file turns measuring back on.\n\n"
                    + NodeName + "\n{\n"
                    + $"  measuring = {(measuring ? "true" : "false")}\n"
                    + "}\n");
                Measuring = measuring;
                return true;
            }
            catch (Exception e)
            {
                Debug.LogError($"[TMinus] Could not write {_path} ({e.GetType().Name}: {e.Message})");
                return false;
            }
        }
    }
}
