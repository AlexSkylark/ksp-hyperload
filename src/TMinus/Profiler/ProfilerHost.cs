using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using HarmonyLib;
using TMinus.Profiler.Hooks;
using TMinus.Report;
using UnityEngine;

namespace TMinus.Profiler
{
    /// <summary>
    /// Owns the profiler for the whole session: applies hooks, listens to KSP's
    /// phase events, and writes the buffered events to disk at checkpoints
    /// (each loader end, main menu, each scene ready, quit).
    /// </summary>
    internal sealed class ProfilerHost : MonoBehaviour
    {
        public const string HarmonyId = "TMinus.Profiler";

        private readonly Dictionary<EventVoid, EventVoid.OnEvent> _phaseHandlers =
            new Dictionary<EventVoid, EventVoid.OnEvent>();

        private List<ProfilerEvent> _spare = new List<ProfilerEvent>(4096);
        private JsonlWriter _writer;
        private LoadingScreenMonitor _monitor;
        /// <summary>Null when the KSP.log summary is turned off in the settings.</summary>
        private LogSummary _summary;
        private bool _startupReported;
        private bool _patchInventory;
        /// <summary>Null when the report button is turned off in the settings.</summary>
        private ReportService _report;

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
                Debug.LogError($"[TMinus] Profiler: cannot write output ({e.Message}), profiler disabled");
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

            if (settings.IsGroupEnabled("logSummary"))
                _summary = new LogSummary();
            _patchInventory = settings.IsGroupEnabled(PatchInventory.Group);
            if (settings.IsGroupEnabled("reportButton"))
                _report = ReportService.Launch(gameObject, Path.GetDirectoryName(pluginDataDirectory), Directory.GetCurrentDirectory(), () => _writer?.FilePath, Flush);

            var scenes = gameObject.AddComponent<SceneTransitionTracker>();
            scenes.TransitionCompleted += label =>
            {
                Checkpoint(label);
                SummarySafely(s => s.Write(label));
            };

            AddPhaseEvent(GameEvents.OnGameDatabaseLoaded, "OnGameDatabaseLoaded");
            AddPhaseEvent(GameEvents.OnUpgradesFilled, "OnUpgradesFilled");
            AddPhaseEvent(GameEvents.OnPartLoaderLoaded, "OnPartLoaderLoaded");
            AddPhaseEvent(GameEvents.OnUpgradesLinked, "OnUpgradesLinked");
            AddPhaseEvent(GameEvents.OnExpansionSystemLoaded, "OnExpansionSystemLoaded");
            GameEvents.onLevelWasLoadedGUIReady.Add(OnSceneGuiReady);

            // We start inside the game's first loading frame, which also runs the
            // Instantly addons and the config scans. Measure it from our own start, so
            // it becomes a long frame; its true start is earlier (a lower bound).
            _lastFrameTicks = ProfilerClock.AnchorTicks;
            FrameCoverage.NextFrame(ProfilerClock.AnchorTicks);
            _lastFrameCollections = GC.CollectionCount(0);

            Debug.Log($"[TMinus] Profiler: recording to {_writer.FilePath}");
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
                Debug.LogWarning($"[TMinus] Profiler: could not hook new loaders ({e.GetType().Name}: {e.Message}), their timing falls back to polling");
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
                LoadingWindow.Close();
                WriteSafely(() => _writer.WriteRecord(RunConditions.WriteMainMenu));
                if (_patchInventory)
                    WriteSafely(() => _writer.WriteRecord(PatchInventory.Write));
                LogStartupSummary();
                _report?.CountdownEnded(ProfilerClock.ToMsSinceProcessStart(ProfilerClock.Now()) / 1000.0);
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
            HarmonyCallHooks.EmitAll();
            CoroutineHooks.EmitAll();
            UnityMessageHooks.EmitAll();
            Flush();
        }

        private void LogStartupSummary()
        {
            var nowSeconds = ProfilerClock.ToMsSinceProcessStart(ProfilerClock.Now()) / 1000.0;
            var loaders = string.Join(", ", _monitor.Loaders.Select(l =>
                $"{ShortName(l.Name)} {(l.StartUnknown ? ">=" : "")}{Seconds(l.DurationMs)}{(l.StartExact && l.EndExact ? "" : "~")}"));

            Debug.Log($"[TMinus] Profiler: main menu ready {nowSeconds.ToString("0.0", CultureInfo.InvariantCulture)} s after process start | loaders: {loaders} (~ = accurate to a frame, >= = started before T-Minus)");
        }

        private void Flush()
        {
            var events = Recorder.Drain(_spare);
            SummarySafely(s => s.Collect(events));
            WriteSafely(() => _writer.WriteEvents(events));
            _spare = events;
        }

        /// <summary>The summary is optional output: on any failure, turn it off and leave the game alone.</summary>
        private void SummarySafely(Action<LogSummary> action)
        {
            if (_summary == null)
                return;

            try
            {
                action(_summary);
            }
            catch (Exception e)
            {
                Debug.LogWarning($"[TMinus] Profiler: KSP.log summary failed ({e.GetType().Name}: {e.Message}), no further summaries this session");
                _summary = null;
            }
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
                Debug.LogError($"[TMinus] Profiler: write failed ({e.Message}), no further output this session");
                _writer.Dispose();
                _writer = null;
            }
        }

        /// <summary>Frames longer than this are recorded individually as "frame.long".</summary>
        private const double LongFrameMs = 500;

        /// <summary>
        /// Covered runs with at least this much inside hooks are recorded per long
        /// frame ("frame.covered"), so the analyzer can tell a log silence the hooks
        /// measured from one they did not. A tenth of the analyzer's smallest gap
        /// (0.5 s): shorter runs are many and small, and the analyzer bounds
        /// what they leave out by the time no hook covers.
        /// </summary>
        private const double CoveredRunMs = 50;

        private long _lastFrameTicks;
        private int _lastFrameCollections;
        private readonly List<FrameCoverage.CoveredRun> _runs = new List<FrameCoverage.CoveredRun>(32);

        /// <summary>
        /// Records unusually long frames, wherever they happen. Shows whether a slow
        /// stretch is one blocking frame or many slow ones, even when no hook covers it.
        /// The first one starts at the profiler's own start (see Initialize). Each one
        /// carries the number of garbage collections inside it: a count, not their time
        /// (Unity 2019.4 has no per-collection timing), and the time spent inside
        /// timed hooks ("covered"): the rest is work no hook attributes. Its longer
        /// covered stretches follow as "frame.covered" spans.
        /// </summary>
        private void Update()
        {
            var now = ProfilerClock.Now();
            var collections = GC.CollectionCount(0);
            var isLong = _lastFrameTicks != 0 && ProfilerClock.DurationMs(_lastFrameTicks, now) >= LongFrameMs;
            _runs.Clear();
            var covered = isLong
                ? FrameCoverage.NextFrame(now, _runs, ProfilerClock.TicksFromMs(CoveredRunMs))
                : FrameCoverage.NextFrame(now);
            if (isLong)
            {
                var scene = HighLogic.LoadedScene.ToString();
                Recorder.Span("frame.long", _lastFrameTicks, now, scene,
                    collections: collections - _lastFrameCollections, coveredMs: ProfilerClock.DurationMs(0, covered));
                foreach (var run in _runs)
                    Recorder.Span("frame.covered", run.Start, run.End, scene, coveredMs: ProfilerClock.DurationMs(0, run.Covered));
            }
            _lastFrameTicks = now;
            _lastFrameCollections = collections;

            // After the frame timing: bracketing is the profiler's own work, inside the next frame.
            HarmonyCallHooks.ApplyPending();
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
