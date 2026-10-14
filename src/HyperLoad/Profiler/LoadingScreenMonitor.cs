using System;
using System.Collections.Generic;
using System.Linq;
using UnityEngine;

namespace HyperLoad.Profiler
{
    /// <summary>Timing of one loading-screen loader (GameDatabase, PartLoader, ModuleManager's PostPatchLoader...).</summary>
    internal sealed class LoaderTiming
    {
        public string Name;
        public long StartTicks;
        /// <summary>True when the start came from the StartLoad hook rather than frame polling.</summary>
        public bool StartExact;
        public long EndTicks;
        /// <summary>True when the end came from the next loader's StartLoad hook rather than frame polling.</summary>
        public bool EndExact;
        public bool Done;
        /// <summary>Last frame in which polling saw this loader still running.</summary>
        public long LastSeenRunningTicks;
        public int Frames;
        public double MaxFrameMs;

        public double DurationMs => ProfilerClock.DurationMs(StartTicks, EndTicks);
    }

    /// <summary>
    /// Times each loader in <c>LoadingScreen.loaders</c> without patching it.
    /// KSP runs the loaders one after another: it calls <c>StartLoad()</c>, then
    /// polls <c>IsReady()</c> once per frame, then starts the next one in the
    /// same step. We poll the same way from <see cref="Update"/>.
    /// <list type="bullet">
    /// <item>When <c>StartLoad</c> is hooked (<see cref="Hooks.LoaderStartHook"/>), it
    /// gives the exact start of a loader and the exact end of the previous one.</item>
    /// <item>Otherwise, times come from polling and are accurate to one frame.</item>
    /// <item>The last loader's end is estimated: KSP switches scene in the same
    /// frame and the loading screen disappears.</item>
    /// <item>Loaders that were already running when HyperLoad loaded (GameDatabase)
    /// only have a "first observed" start.</item>
    /// </list>
    /// </summary>
    internal sealed class LoadingScreenMonitor : MonoBehaviour
    {
        private static LoadingScreenMonitor _instance;

        private readonly Dictionary<LoadingSystem, LoaderTiming> _timings = new Dictionary<LoadingSystem, LoaderTiming>();
        private readonly List<LoaderTiming> _ordered = new List<LoaderTiming>();
        private LoaderTiming _current;
        private long _lastFrameTicks;
        private int _lastLoaderCount = -1;
        private bool _finished;

        /// <summary>Raised on the main thread after each loader finishes.</summary>
        public event Action LoaderFinished;

        /// <summary>Raised once, after the last loader finishes.</summary>
        public event Action AllFinished;

        public IReadOnlyList<LoaderTiming> Loaders => _ordered;

        /// <summary>Called from the StartLoad hook.</summary>
        public static void NotifyStartLoad(LoadingSystem loader)
        {
            var self = _instance;
            if (self == null || self._finished)
                return;

            var now = ProfilerClock.Now();

            // KSP only starts a loader once every earlier one is ready, so this is
            // also the exact end of any earlier loader we haven't seen finish yet.
            var screen = LoadingScreen.Instance;
            if (screen != null)
            {
                LoaderTiming previous = null;
                foreach (var earlier in screen.loaders)
                {
                    if (earlier == loader)
                        break;
                    var earlierTiming = self.GetTiming(earlier);
                    if (!earlierTiming.Done)
                        self.Complete(earlierTiming, previous, now, endExact: true);
                    previous = earlierTiming;
                }
            }

            var timing = self.GetTiming(loader);
            timing.StartTicks = now;
            timing.StartExact = true;
        }

        private void Awake() => _instance = this;

        private void OnDestroy()
        {
            if (_instance == this)
                _instance = null;
        }

        private void Update()
        {
            if (_finished)
                return;

            var now = ProfilerClock.Now();
            var frameMs = _lastFrameTicks == 0 ? 0 : ProfilerClock.DurationMs(_lastFrameTicks, now);
            _lastFrameTicks = now;

            var screen = LoadingScreen.Instance;
            if (screen == null)
            {
                // The loading screen is gone. KSP only leaves it once every loader is
                // ready, so the one still running when we last looked finished between
                // that frame and now: use the earlier bound and flag it as estimated.
                if (_ordered.Count > 0)
                {
                    if (_current != null && !_current.Done)
                    {
                        Recorder.Mark("loader.endEstimated", _current.Name);
                        Complete(_current, null, _current.LastSeenRunningTicks, endExact: false);
                    }
                    Finish();
                }
                return;
            }

            var loaders = screen.loaders;
            if (loaders.Count != _lastLoaderCount)
            {
                _lastLoaderCount = loaders.Count;
                Recorder.Mark("loading.loaders", string.Join(",", loaders.Select(LoaderName)));
            }

            LoaderTiming previous = null;
            for (var i = 0; i < loaders.Count; i++)
            {
                var timing = GetTiming(loaders[i]);
                if (!timing.Done && IsReady(loaders[i], timing))
                    Complete(timing, previous, now, endExact: false);

                if (!timing.Done)
                {
                    // KSP runs loaders in order, so the first unfinished one is the current one.
                    if (timing.StartTicks == 0)
                        StartObserved(timing, previous, now);
                    timing.Frames++;
                    timing.MaxFrameMs = Math.Max(timing.MaxFrameMs, frameMs);
                    timing.LastSeenRunningTicks = now;
                    _current = timing;
                    return;
                }

                previous = timing;
            }

            if (loaders.Count > 0)
                Finish();
        }

        private LoaderTiming GetTiming(LoadingSystem loader)
        {
            if (!_timings.TryGetValue(loader, out var timing))
            {
                timing = new LoaderTiming { Name = LoaderName(loader) };
                _timings.Add(loader, timing);
                _ordered.Add(timing);
            }
            return timing;
        }

        private static bool IsReady(LoadingSystem loader, LoaderTiming timing)
        {
            try
            {
                return loader.IsReady();
            }
            catch (Exception e)
            {
                // KSP calls IsReady every frame too, so this should not happen; stop watching this loader.
                Debug.LogWarning($"[HyperLoad] Profiler: {timing.Name}.IsReady() threw ({e.Message}), no longer timing it");
                Recorder.Mark("loader.pollFailed", timing.Name);
                timing.Done = true;
                return false;
            }
        }

        private static void StartObserved(LoaderTiming timing, LoaderTiming previous, long now)
        {
            if (previous != null)
            {
                timing.StartTicks = previous.EndTicks;
            }
            else
            {
                timing.StartTicks = now;
                Recorder.Mark("loader.startUnknown", timing.Name);
            }
        }

        private void Complete(LoaderTiming timing, LoaderTiming previous, long now, bool endExact)
        {
            if (timing.StartTicks == 0)
                StartObserved(timing, previous, now);

            timing.EndTicks = now;
            timing.EndExact = endExact;
            timing.Done = true;

            Recorder.Span("loader", timing.StartTicks, timing.EndTicks, timing.Name);
            Recorder.Counter("loader.frames", timing.Frames, timing.Name);
            Recorder.Counter("loader.maxFrameMs", timing.MaxFrameMs, timing.Name);
            Recorder.Memory("loader.end", timing.Name);

            LoaderFinished?.Invoke();
        }

        private void Finish()
        {
            _finished = true;
            Recorder.Mark("loading.complete");
            AllFinished?.Invoke();
            enabled = false;
        }

        private static string LoaderName(LoadingSystem loader) => loader.GetType().FullName;
    }
}
