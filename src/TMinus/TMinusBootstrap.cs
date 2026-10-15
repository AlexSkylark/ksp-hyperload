using System.IO;
using System.Reflection;
using TMinus.Profiler;
using UnityEngine;

namespace TMinus
{
    /// <summary>
    /// Entry point. Runs once, as soon as KSP loads our assembly.
    /// </summary>
    [KSPAddon(KSPAddon.Startup.Instantly, true)]
    public sealed class TMinusBootstrap : MonoBehaviour
    {
        private void Awake()
        {
            // First thing: every later measurement is relative to this anchor.
            ProfilerClock.Initialize();

            var assembly = typeof(TMinusBootstrap).Assembly;
            var version = assembly.GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion
                ?? assembly.GetName().Version.ToString();

            Debug.Log($"[TMinus] T-Minus {version} loaded");

            // <mod folder>/Plugins/TMinus.dll -> <mod folder>/PluginData
            var modFolder = Path.GetDirectoryName(Path.GetDirectoryName(assembly.Location));
            var pluginData = Path.Combine(modFolder, "PluginData");

            var settings = ProfilerSettings.Load(pluginData);
            if (!settings.Enabled)
            {
                Debug.Log("[TMinus] Profiler: disabled in settings");
                return;
            }

            DontDestroyOnLoad(gameObject);
            ProfilerHost.Launch(gameObject, pluginData, settings);
        }
    }
}
