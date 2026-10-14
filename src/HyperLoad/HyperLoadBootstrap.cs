using System.Reflection;
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
            var assembly = typeof(HyperLoadBootstrap).Assembly;
            var version = assembly.GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion
                ?? assembly.GetName().Version.ToString();

            Debug.Log($"[HyperLoad] HyperLoad {version} loaded");
        }
    }
}
