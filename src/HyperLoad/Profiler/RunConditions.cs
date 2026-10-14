using System;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using UnityEngine;

namespace HyperLoad.Profiler
{
    /// <summary>
    /// Everything that makes one run comparable (or not) to another: versions,
    /// installed assemblies, hardware, and cache states that change load times.
    /// </summary>
    internal static class RunConditions
    {
        /// <summary>Written once at startup, as the first line of the run file.</summary>
        public static void WriteStartup(JsonLine j)
        {
            var assemblies = AssemblyLoader.loadedAssemblies
                .Select(a => $"{a.name} {a.versionMajor}.{a.versionMinor}.{a.versionRevision} ({a.dllName})")
                .OrderBy(s => s, StringComparer.Ordinal)
                .ToList();

            var kspcf = AssemblyLoader.loadedAssemblies.FirstOrDefault(a => a.name == "KSPCommunityFixes");

            j.Field("kind", "run")
                .Field("hyperload", HyperLoadVersion())
                .Field("ksp", KspVersion())
                .Field("unity", Application.unityVersion)
                .Field("processStartUtc", ProfilerClock.ProcessStartUtc.ToString("o"))
                .Field("processStartKnown", ProfilerClock.ProcessStartKnown)
                .Field("profilerStartMs", ProfilerClock.ToMsSinceProcessStart(ProfilerClock.AnchorTicks))
                .Field("realtimeSinceStartupMs", ProfilerClock.AnchorRealtimeSinceStartup * 1000.0)
                .Field("uptimeAtProcessStartMs", UptimeAtProcessStartMs())
                .Field("cpu", SystemInfo.processorType)
                .Field("ramMb", SystemInfo.systemMemorySize)
                .Field("gpu", SystemInfo.graphicsDeviceName)
                .Field("kspcf", kspcf == null ? null : FileVersion(kspcf.assembly))
                .Field("kspcfTextureCache", KspcfTextureCacheEnabled())
                .Field("moduleManager", AssemblyLoader.loadedAssemblies.Any(a => a.name == "ModuleManager"))
                .Field("assemblyCount", assemblies.Count)
                .Field("assemblyHash", Sha1(string.Join("\n", assemblies)))
                .Field("assemblies", assemblies);
        }

        /// <summary>
        /// Written when the main menu is reached: cache states that are only
        /// known after loading. [I] ModuleManager writes ConfigSHA/ConfigCache only
        /// on a cold run that had no patch errors, and deletes them when it had
        /// errors; a warm run leaves them untouched. A cold run also rebuilds
        /// PartDatabase.cfg.
        /// </summary>
        public static void WriteMainMenu(JsonLine j)
        {
            var root = KSPUtil.ApplicationRootPath;
            var configSha = Path.Combine(root, "GameData/ModuleManager.ConfigSHA");
            var shaWritten = WrittenThisRun(configSha);
            var partDatabaseWritten = WrittenThisRun(Path.Combine(root, "PartDatabase.cfg"));

            string mmCache;
            if (!AssemblyLoader.loadedAssemblies.Any(a => a.name == "ModuleManager"))
                mmCache = "absent";
            else if (shaWritten == true)
                mmCache = "cold";
            else if (shaWritten == false)
                mmCache = "warm";
            else
                mmCache = "cold-unsaved"; // no cache file: cold run whose cache was not saved (patch errors)

            j.Field("kind", "conditions")
                .Field("t", ProfilerClock.ToMsSinceProcessStart(ProfilerClock.Now()))
                .Field("mmCache", mmCache)
                .Field("partDatabaseRebuilt", partDatabaseWritten);
        }

        /// <summary>Null when the file does not exist.</summary>
        private static bool? WrittenThisRun(string path)
        {
            try
            {
                if (!File.Exists(path))
                    return null;
                return File.GetLastWriteTimeUtc(path) >= ProfilerClock.ProcessStartUtc;
            }
            catch (Exception)
            {
                return null;
            }
        }

        private static string HyperLoadVersion()
        {
            var assembly = typeof(RunConditions).Assembly;
            return assembly.GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion
                ?? assembly.GetName().Version.ToString();
        }

        /// <summary>
        /// Release version of another mod's assembly. Mods often keep AssemblyVersion
        /// fixed across releases (KSPCF 1.41.1 reports 1.41.0.0), so prefer the file version.
        /// </summary>
        private static string FileVersion(Assembly assembly) =>
            assembly.GetCustomAttribute<AssemblyFileVersionAttribute>()?.Version
            ?? assembly.GetName().Version.ToString();

        private static string KspVersion()
        {
            try
            {
                return $"{Versioning.VersionString} build {Versioning.BuildID}";
            }
            catch (Exception)
            {
                return null;
            }
        }

        /// <summary>The KSPCF PNG texture cache opt-in, or null if KSPCF never asked.</summary>
        private static bool? KspcfTextureCacheEnabled()
        {
            try
            {
                var path = Path.Combine(KSPUtil.ApplicationRootPath, "GameData/KSPCommunityFixes/PluginData/PNGTextureCache.cfg");
                if (!File.Exists(path))
                    return null;
                var enabled = false;
                return ConfigNode.Load(path).TryGetValue("textureCacheEnabled", ref enabled) ? enabled : (bool?)null;
            }
            catch (Exception)
            {
                return null;
            }
        }

        /// <summary>
        /// How long the OS had been running when KSP started: a proxy for whether the
        /// OS file cache is cold (first run after a reboot) or warm.
        /// </summary>
        private static long UptimeAtProcessStartMs()
        {
            long uptimeNow;
            try
            {
                uptimeNow = (long)GetTickCount64();
            }
            catch (Exception)
            {
                // Not Windows: Environment.TickCount wraps after ~49 days, good enough here.
                uptimeNow = unchecked((uint)Environment.TickCount);
            }
            return uptimeNow - (long)(DateTime.UtcNow - ProfilerClock.ProcessStartUtc).TotalMilliseconds;
        }

        [DllImport("kernel32.dll")]
        private static extern ulong GetTickCount64();

        private static string Sha1(string text)
        {
            using (var sha = SHA1.Create())
            {
                var hash = sha.ComputeHash(Encoding.UTF8.GetBytes(text));
                return BitConverter.ToString(hash).Replace("-", "").ToLowerInvariant();
            }
        }
    }
}
