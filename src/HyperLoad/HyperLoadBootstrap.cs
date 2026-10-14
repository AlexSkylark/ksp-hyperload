using System.IO;
using System.Reflection;
using HyperLoad.Profiler;
using UnityEngine;

namespace HyperLoad
{
    /// <summary>
    /// Entry point. Runs once, as soon as KSP loads our assembly.
    /// </summary>
    [KSPAddon(KSPAddon.Startup.Instantly, true)]
    public sealed class HyperLoadBootstrap : MonoBehaviour
    {
        private void Awake()
        {
            // First thing: every later measurement is relative to this anchor.
            ProfilerClock.Initialize();

            var assembly = typeof(HyperLoadBootstrap).Assembly;
            var version = assembly.GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion
                ?? assembly.GetName().Version.ToString();

            Debug.Log($"[HyperLoad] HyperLoad {version} loaded");

            // <mod folder>/Plugins/HyperLoad.dll -> <mod folder>/PluginData
            var modFolder = Path.GetDirectoryName(Path.GetDirectoryName(assembly.Location));
            var pluginData = Path.Combine(modFolder, "PluginData");

            var settings = ProfilerSettings.Load(pluginData);
            if (!settings.Enabled)
            {
                Debug.Log("[HyperLoad] Profiler: disabled in settings");
                return;
            }

            DontDestroyOnLoad(gameObject);
            ProfilerHost.Launch(gameObject, pluginData, settings);
        }
    }
}
