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
        /// <summary>True when the loader was already running before we first looked (real start is earlier).</summary>
        public bool StartUnknown;
        public long EndTicks;
        /// <summary>True when the end came from the next loader's StartLoad hook rather than frame polling.</summary>
        public bool EndExact;
        public bool Done;
        public int Frames;
        public double MaxFrameMs;
        /// <summary>Last frame in which polling saw this loader still running.</summary>
        public long LastSeenRunningTicks;

        public double DurationMs => ProfilerClock.DurationMs(StartTicks, EndTicks);
    }

    /// <summary>
    /// Times each loader in <c>LoadingScreen.loaders</c> without patching it.
    /// KSP runs the loaders one after another: it calls <c>StartLoad()</c>, then
    /// polls <c>IsReady()</c> once per frame, then starts the next one in the
    /// same step. We poll the same way from <see cref="Update"/>.
    /// <list type="bullet">
    /// <item>When a loader's <c>StartLoad</c> is hooked (<see cref="Hooks.LoaderStartHook"/>),
    /// it gives the exact start of that loader and the exact end of the one right before it.</item>
    /// <item>Otherwise, times come from polling and are accurate to one frame.</item>
    /// <item>Loaders still running when the loading screen disappears (KSP switches
    /// scene in the same frame the last one finishes) get an estimated end.</item>
    /// <item>Loaders already running when HyperLoad loaded (GameDatabase) only have
    /// a "first observed" start.</item>
    /// </list>
    /// </summary>
    internal sealed class LoadingScreenMonitor : MonoBehaviour
    {
        private static LoadingScreenMonitor _instance;

        private readonly Dictionary<LoadingSystem, LoaderTiming> _timings = new Dictionary<LoadingSystem, LoaderTiming>();
        private readonly List<LoaderTiming> _ordered = new List<LoaderTiming>();
        private List<LoadingSystem> _lastLoaders = new List<LoadingSystem>();
        private long _lastFrameTicks;
        private bool _finished;

        /// <summary>Raised when loaders are added or removed, with the current list.</summary>
        public event Action<List<LoadingSystem>> LoadersChanged;

        /// <summary>Raised on the main thread after each loader finishes.</summary>
        public event Action LoaderFinished;

        /// <summary>Raised once, after the last loader finishes.</summary>
        public event Action AllFinished;

        /// <summary>Loaders in the order they finished.</summary>
        public IReadOnlyList<LoaderTiming> Loaders => _ordered;

        /// <summary>Called from the StartLoad hook.</summary>
        public static void NotifyStartLoad(LoadingSystem loader)
        {
            var self = _instance;
            if (self == null || self._finished)
                return;

            var now = ProfilerClock.Now();

            // KSP only starts a loader once every earlier one is ready, so anything
            // earlier still open has finished. For the loader right before this one,
            // "now" is its exact end; earlier ones (not hooked, finished unseen in
            // between) only get an upper bound.
            var screen = LoadingScreen.Instance;
            if (screen != null)
            {
                var loaders = screen.loaders;
                var index = loaders.IndexOf(loader);
                LoaderTiming previous = null;
                for (var i = 0; i < index; i++)
                {
                    var earlier = self.GetTiming(loaders[i]);
                    if (!earlier.Done)
                        self.Complete(earlier, previous, now, endExact: i == index - 1);
                    previous = earlier;
                }
            }

            var timing = self.GetTiming(loader);
            timing.StartTicks = now;
            timing.StartExact = true;
            timing.StartUnknown = false;
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
                if (_ordered.Count > 0)
                    FinishAfterScreenGone();
                return;
            }

            var loaders = screen.loaders;
            if (!loaders.SequenceEqual(_lastLoaders))
            {
                _lastLoaders = new List<LoadingSystem>(loaders);
                Recorder.Mark("loading.loaders", string.Join(",", loaders.Select(LoaderName)));
                LoadersChanged?.Invoke(_lastLoaders);
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
                    return;
                }

                previous = timing;
            }

            if (loaders.Count > 0)
                Finish();
        }

        /// <summary>
        /// The loading screen is gone. KSP only leaves it once every loader is ready,
        /// so whatever was still open finished between the last frame we saw it
        /// running and now. Use that earlier bound and flag it as estimated.
        /// </summary>
        private void FinishAfterScreenGone()
        {
            LoaderTiming previous = null;
            foreach (var loader in _lastLoaders)
            {
                var timing = GetTiming(loader);
                if (!timing.Done)
                {
                    var end = timing.LastSeenRunningTicks != 0 ? timing.LastSeenRunningTicks
                        : previous != null ? previous.EndTicks
                        : ProfilerClock.Now();
                    Recorder.Mark("loader.endEstimated", timing.Name);
                    Complete(timing, previous, end, endExact: false);
                }
                previous = timing;
            }
            Finish();
        }

        private LoaderTiming GetTiming(LoadingSystem loader)
        {
            if (!_timings.TryGetValue(loader, out var timing))
            {
                timing = new LoaderTiming { Name = LoaderName(loader) };
                _timings.Add(loader, timing);
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

                // If the previous loader had already finished when we first looked, its
                // "end" is just our first observation, so this start is unknown too.
                if (previous.StartUnknown && previous.Frames == 0)
                {
                    timing.StartUnknown = true;
                    Recorder.Mark("loader.startUnknown", timing.Name);
                }
            }
            else
            {
                timing.StartTicks = now;
                timing.StartUnknown = true;
                Recorder.Mark("loader.startUnknown", timing.Name);
            }
        }

        private void Complete(LoaderTiming timing, LoaderTiming previous, long end, bool endExact)
        {
            if (timing.StartTicks == 0)
                StartObserved(timing, previous, end);

            timing.EndTicks = end;
            timing.EndExact = endExact;
            timing.Done = true;
            _ordered.Add(timing);

            Recorder.Span("loader", timing.StartTicks, timing.EndTicks, timing.Name,
                approximate: !(timing.StartExact && timing.EndExact));
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
