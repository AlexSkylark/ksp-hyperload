using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using HarmonyLib;
using HyperLoad.Profiler.Hooks;
using UnityEngine;

namespace HyperLoad.Profiler
{
    /// <summary>
    /// Owns the profiler for the whole session: applies hooks, listens to KSP's
    /// phase events, and writes the buffered events to disk at checkpoints
    /// (each loader end, main menu, each scene ready, quit).
    /// </summary>
    internal sealed class ProfilerHost : MonoBehaviour
    {
        public const string HarmonyId = "HyperLoad.Profiler";

        private readonly Dictionary<EventVoid, EventVoid.OnEvent> _phaseHandlers =
            new Dictionary<EventVoid, EventVoid.OnEvent>();

        private List<ProfilerEvent> _spare = new List<ProfilerEvent>(4096);
        private JsonlWriter _writer;
        private LoadingScreenMonitor _monitor;
        private bool _startupReported;

        /// <summary>Starts profiling. Call once, from the Instantly bootstrap's Awake.</summary>
        public static void Launch(GameObject host, string pluginDataDirectory, ProfilerSettings settings)
        {
            host.AddComponent<ProfilerHost>().Initialize(pluginDataDirectory, settings);
        }

        private void Initialize(string pluginDataDirectory, ProfilerSettings settings)
        {
            Recorder.Initialize();
            Recorder.Span("startup.preProfiler", ProfilerClock.ProcessStartTicks, ProfilerClock.AnchorTicks);
            Recorder.Memory("profiler.start");

            try
            {
                _writer = new JsonlWriter(Path.Combine(pluginDataDirectory, "Profiler"));
                _writer.WriteRecord(RunConditions.WriteStartup);
                _writer.Flush();
            }
            catch (Exception e)
            {
                // Without an output file the measurements are useless: keep the game untouched.
                Debug.LogError($"[HyperLoad] Profiler: cannot write output ({e.Message}), profiler disabled");
                _writer?.Dispose();
                _writer = null;
                Destroy(this);
                return;
            }

            var loaderStartHook = new LoaderStartHook();
            HookRegistry.ApplyAll(new Harmony(HarmonyId), settings, HookCatalog.Create(loaderStartHook));

            _monitor = gameObject.AddComponent<LoadingScreenMonitor>();
            _monitor.LoaderFinished += Flush;
            _monitor.AllFinished += () => Checkpoint(null);
            _monitor.LoadersChanged += loaders => PatchNewLoaders(loaderStartHook, loaders);

            AddPhaseEvent(GameEvents.OnGameDatabaseLoaded, "OnGameDatabaseLoaded");
            AddPhaseEvent(GameEvents.OnUpgradesFilled, "OnUpgradesFilled");
            AddPhaseEvent(GameEvents.OnPartLoaderLoaded, "OnPartLoaderLoaded");
            AddPhaseEvent(GameEvents.OnUpgradesLinked, "OnUpgradesLinked");
            AddPhaseEvent(GameEvents.OnExpansionSystemLoaded, "OnExpansionSystemLoaded");
            GameEvents.onLevelWasLoadedGUIReady.Add(OnSceneGuiReady);

            Debug.Log($"[HyperLoad] Profiler: recording to {_writer.FilePath}");
        }

        /// <summary>Mods add loaders from their own Instantly addons, after ours: hook them too.</summary>
        private static void PatchNewLoaders(LoaderStartHook hook, List<LoadingSystem> loaders)
        {
            try
            {
                hook.PatchLoaders(loaders);
            }
            catch (Exception e)
            {
                Debug.LogWarning($"[HyperLoad] Profiler: could not hook new loaders ({e.GetType().Name}: {e.Message}), their timing falls back to polling");
                Recorder.Mark("hook.unavailable", hook.Id + ".newLoaders");
            }
        }

        private void AddPhaseEvent(EventVoid gameEvent, string name)
        {
            EventVoid.OnEvent handler = () => Recorder.Memory("phase", name);
            gameEvent.Add(handler);
            _phaseHandlers.Add(gameEvent, handler);
        }

        private void OnSceneGuiReady(GameScenes scene)
        {
            Recorder.Memory("scene.guiReady", scene.ToString());

            if (scene == GameScenes.MAINMENU && !_startupReported)
            {
                _startupReported = true;
                WriteSafely(() => _writer.WriteRecord(RunConditions.WriteMainMenu));
                LogStartupSummary();
            }

            Checkpoint(scene.ToString());
        }

        /// <summary>
        /// End of a phase (loading complete, a scene ready): write aggregates for the
        /// calls since the previous checkpoint, then everything buffered.
        /// </summary>
        private void Checkpoint(string label)
        {
            Recorder.Mark("checkpoint", label);
            TimingAggregate.EmitAll();
            Flush();
        }

        private void LogStartupSummary()
        {
            var nowSeconds = ProfilerClock.ToMsSinceProcessStart(ProfilerClock.Now()) / 1000.0;
            var loaders = string.Join(", ", _monitor.Loaders.Select(l =>
                $"{ShortName(l.Name)} {(l.StartUnknown ? ">=" : "")}{Seconds(l.DurationMs)}{(l.StartExact && l.EndExact ? "" : "~")}"));

            Debug.Log($"[HyperLoad] Profiler: main menu ready {nowSeconds.ToString("0.0", CultureInfo.InvariantCulture)} s after process start | loaders: {loaders} (~ = accurate to a frame, >= = started before HyperLoad)");
        }

        private void Flush()
        {
            if (_writer == null)
                return;

            var events = Recorder.Drain(_spare);
            WriteSafely(() => _writer.WriteEvents(events));
            _spare = events;
        }

        private void WriteSafely(Action write)
        {
            if (_writer == null)
                return;

            try
            {
                write();
            }
            catch (Exception e)
            {
                Debug.LogError($"[HyperLoad] Profiler: write failed ({e.Message}), no further output this session");
                _writer.Dispose();
                _writer = null;
            }
        }

        private void OnApplicationQuit()
        {
            Recorder.Mark("session.quit");
            Checkpoint("quit");
        }

        private void OnDestroy()
        {
            foreach (var pair in _phaseHandlers)
                pair.Key.Remove(pair.Value);
            GameEvents.onLevelWasLoadedGUIReady.Remove(OnSceneGuiReady);

            Flush();
            _writer?.Dispose();
            _writer = null;
        }

        private static string ShortName(string typeName)
        {
            var dot = typeName.LastIndexOf('.');
            return dot < 0 ? typeName : typeName.Substring(dot + 1);
        }

        private static string Seconds(double ms) => (ms / 1000.0).ToString("0.0", CultureInfo.InvariantCulture) + " s";
    }
}
