using System;
using System.Globalization;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace TMinus.Profiler
{
    /// <summary>
    /// Times each scene transition, from the request (<c>HighLogic.LoadScene</c>)
    /// to the moment the player can use the new scene, then watches the first
    /// frames after that for hitches.
    /// <para>
    /// "Ready" is the same rule for every scene: the first moment, from
    /// <c>onLevelWasLoadedGUIReady</c> on, at which KSP's loading overlay
    /// (<c>LoadingBufferMask</c>) is hidden. GUI ready comes one frame after the
    /// scene loaded, so after the scene's Start methods; the overlay can stay
    /// longer (flight waits for the active vessel; a buffered switch to the space
    /// center or the editor waits a fixed number of frames, plus 2 s at the space
    /// center). The overlay can also be hidden before GUI ready (stock hides it on
    /// each additively loaded scene, such as the editor's building), and then GUI
    /// ready is the end. See docs/mechanisms.md, 6.1.
    /// </para>
    /// <para>
    /// Every milestone is recorded as a "scene.marker" so the analysis can pick
    /// another definition later.
    /// </para>
    /// </summary>
    internal sealed class SceneTransitionTracker : MonoBehaviour
    {
        public const string GuiReady = "guiReady";
        public const string MaskShown = "LoadingBufferMask.Show";
        public const string MaskHidden = "LoadingBufferMask.Hide";
        public const string EditorStarted = "onEditorStarted";

        /// <summary>Frames observed after "ready".</summary>
        private const int PostReadyFrames = 120;
        /// <summary>A frame slower than this after "ready" counts as a hitch.</summary>
        private const double HitchMs = 50;

        private sealed class Transition
        {
            public GameScenes To;
            public string Label;
            public long StartTicks;
            public bool GuiReadySeen;
            public long GuiReadyTicks;
        }

        private static SceneTransitionTracker _instance;

        private Transition _active;
        /// <summary>Last state set by LoadingBufferMask.Show/Hide; false until the first call.</summary>
        private bool _maskVisible;

        private string _postReadyLabel;
        private int _postReadyFrames;
        private long _postReadyStartTicks;
        private double _postReadyMaxMs;
        private int _postReadyHitches;
        private long _lastFrameTicks;

        /// <summary>Raised on the main thread when a transition reaches "ready", with its label.</summary>
        public event Action<string> TransitionCompleted;

        /// <summary>Called from the HighLogic.LoadScene prefix.</summary>
        public static void OnLoadSceneRequested(GameScenes to)
        {
            var self = _instance;
            if (self == null)
                return;

            LoadingWindow.Open();
            if (self._active != null)
                Recorder.Mark("scene.transition.unfinished", self._active.Label);

            var label = $"{HighLogic.LoadedScene}->{to}";
            self._active = new Transition { To = to, Label = label, StartTicks = ProfilerClock.Now() };
            self._postReadyLabel = null;
            Recorder.Memory("scene.loadRequested", label);
        }

        /// <summary>A milestone in <paramref name="scene"/>; completes the transition when it makes the scene ready.</summary>
        public static void OnMarker(string marker, GameScenes scene)
        {
            var self = _instance;
            if (self == null)
                return;

            if (marker == MaskShown)
                self._maskVisible = true;
            else if (marker == MaskHidden)
                self._maskVisible = false;

            var active = self._active;
            if (active == null || active.To != scene)
            {
                Recorder.Mark("scene.marker", $"{scene}:{marker}");
                return;
            }

            Recorder.Mark("scene.marker", $"{active.Label}:{marker}");
            if (marker == GuiReady)
            {
                active.GuiReadySeen = true;
                active.GuiReadyTicks = ProfilerClock.Now();
                if (!self._maskVisible)
                    self.Complete(active, "guiReady, overlay already hidden");
            }
            else if (marker == MaskHidden && active.GuiReadySeen)
            {
                self.Complete(active, marker);
            }
        }

        private void Awake()
        {
            _instance = this;
            SceneManager.sceneLoaded += OnUnitySceneLoaded;
            GameEvents.onLevelWasLoadedGUIReady.Add(OnGuiReady);
            GameEvents.onEditorStarted.Add(OnEditorStarted);
            GameEvents.onFlightReady.Add(OnFlightReady);
        }

        private void OnDestroy()
        {
            SceneManager.sceneLoaded -= OnUnitySceneLoaded;
            GameEvents.onLevelWasLoadedGUIReady.Remove(OnGuiReady);
            GameEvents.onEditorStarted.Remove(OnEditorStarted);
            GameEvents.onFlightReady.Remove(OnFlightReady);
            if (_instance == this)
                _instance = null;
        }

        private void OnUnitySceneLoaded(Scene scene, LoadSceneMode mode) =>
            Recorder.Mark("scene.unityLoaded", scene.name);

        private void OnGuiReady(GameScenes scene) => OnMarker(GuiReady, scene);

        private void OnEditorStarted() => OnMarker(EditorStarted, GameScenes.EDITOR);

        private void OnFlightReady() => OnMarker("onFlightReady", GameScenes.FLIGHT);

        private void Complete(Transition transition, string marker)
        {
            var now = ProfilerClock.Now();
            _active = null;

            Recorder.Span("scene.transition", transition.StartTicks, now, transition.Label);
            // How long the overlay outlasted GUI ready: stock's fixed waits on buffered
            // switches, or flight waiting for its vessel (docs/mechanisms.md, 6.1, 6.2).
            Recorder.Counter("scene.overlayAfterGuiReady", ProfilerClock.DurationMs(transition.GuiReadyTicks, now), transition.Label);
            Recorder.Memory("scene.ready", transition.Label);

            var seconds = ProfilerClock.DurationMs(transition.StartTicks, now) / 1000.0;
            Debug.Log($"[TMinus] Profiler: scene {transition.Label} ready in {seconds.ToString("0.00", CultureInfo.InvariantCulture)} s ({marker})");

            _postReadyLabel = transition.Label;
            _postReadyFrames = 0;
            _postReadyStartTicks = now;
            _postReadyMaxMs = 0;
            _postReadyHitches = 0;

            LoadingWindow.Close();
            TransitionCompleted?.Invoke(transition.Label);
        }

        private void Update()
        {
            var now = ProfilerClock.Now();
            var frameMs = _lastFrameTicks == 0 ? 0 : ProfilerClock.DurationMs(_lastFrameTicks, now);
            _lastFrameTicks = now;

            if (_postReadyLabel == null)
                return;

            // The first Update after "ready" closes a frame that started before it: skip it.
            if (_postReadyFrames > 0)
            {
                _postReadyMaxMs = Math.Max(_postReadyMaxMs, frameMs);
                if (frameMs >= HitchMs)
                    _postReadyHitches++;
            }

            if (++_postReadyFrames <= PostReadyFrames)
                return;

            Recorder.Span("scene.postReady", _postReadyStartTicks, now, _postReadyLabel);
            Recorder.Counter("scene.postReady.maxFrameMs", _postReadyMaxMs, _postReadyLabel);
            Recorder.Counter("scene.postReady.hitches", _postReadyHitches, _postReadyLabel);
            _postReadyLabel = null;
        }
    }
}
