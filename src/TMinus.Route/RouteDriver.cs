using System;
using System.Collections;
using System.Linq;
using System.Reflection;
using KSP.UI;
using KSP.UI.Screens;
using UnityEngine;

namespace TMinus.Route
{
    /// <summary>
    /// Dev-only: plays the validation route of docs/benchmarks/protocol.md by
    /// itself, then quits. Main menu, load the save, Space Center, VAB, load
    /// Kerbal X, Launch, Space Center, Tracking Station, Space Center, main menu.
    ///
    /// Inert unless KSP is started with -tminus-route. Each step goes through
    /// the method the stock button calls (private ones by reflection), so the
    /// game does the same work as when a player clicks. On any problem it writes
    /// "[TMinusRoute] FAILED" and quits, so a script never waits on a stuck game.
    /// </summary>
    [KSPAddon(KSPAddon.Startup.Instantly, true)]
    public sealed class RouteDriver : MonoBehaviour
    {
        private const string Flag = "-tminus-route";
        private const string SaveFlag = "-tminus-route-save=";
        private const string Tag = "[TMinusRoute] ";

        /// <summary>Longest wait for one step: startup on a large install takes minutes.</summary>
        private const float StepTimeout = 30 * 60;

        private string _save = "hyperload-dev";
        private GameScenes? _readyScene;
        private bool _editorStarted;
        private bool _flightReady;

        private void Awake()
        {
            var args = Environment.GetCommandLineArgs();
            if (!args.Contains(Flag))
            {
                Destroy(this);
                return;
            }
            var save = args.FirstOrDefault(a => a.StartsWith(SaveFlag, StringComparison.Ordinal));
            if (save != null) _save = save.Substring(SaveFlag.Length);

            DontDestroyOnLoad(gameObject);
            GameEvents.onLevelWasLoadedGUIReady.Add(OnGuiReady);
            GameEvents.onEditorStarted.Add(OnEditorStarted);
            GameEvents.onFlightReady.Add(OnFlightReady);
            Debug.Log($"{Tag}active, save '{_save}'");
            StartCoroutine(Run());
        }

        private void OnDestroy()
        {
            GameEvents.onLevelWasLoadedGUIReady.Remove(OnGuiReady);
            GameEvents.onEditorStarted.Remove(OnEditorStarted);
            GameEvents.onFlightReady.Remove(OnFlightReady);
        }

        private void OnGuiReady(GameScenes scene) => _readyScene = scene;
        private void OnEditorStarted() => _editorStarted = true;
        private void OnFlightReady() => _flightReady = true;

        private string _step = "startup";
        private string _failure;

        private IEnumerator Run()
        {
            var steps = new Func<IEnumerator>[]
            {
                () => Wait("main menu", () => Ready(GameScenes.MAINMENU) && !PopupDialog.CheckForOpenDialogs(), dwell: 10),
                LoadSave,
                EnterVab,
                LoadCraft,
                Launch,
                FlightToSpaceCenter,
                EnterTrackingStation,
                LeaveTrackingStation,
                SpaceCenterToMainMenu,
            };
            foreach (var step in steps)
            {
                yield return step();
                if (_failure != null)
                {
                    Debug.LogError($"{Tag}FAILED {_step}: {_failure}");
                    PopupDialog.DismissPopup("TestWarning");
                    Application.Quit();
                    yield break;
                }
            }
            Debug.Log($"{Tag}done");
            Application.Quit();
        }

        private bool Ready(GameScenes scene) => _readyScene == scene && HighLogic.LoadedScene == scene;

        /// <summary>
        /// Waits (real time: pause menus stop game time) until the condition
        /// holds, then dwells as the protocol does. Sets _failure on timeout.
        /// </summary>
        private IEnumerator Wait(string step, Func<bool> ready, float dwell)
        {
            _step = step;
            var start = Time.realtimeSinceStartup;
            while (!ready())
            {
                if (_failure != null) yield break;
                if (Time.realtimeSinceStartup - start > StepTimeout)
                {
                    _failure = $"not ready after {StepTimeout:0} s (scene {HighLogic.LoadedScene})";
                    yield break;
                }
                yield return null;
            }
            Debug.Log($"{Tag}step {step} ready after {Time.realtimeSinceStartup - start:0.0} s");
            yield return new WaitForSecondsRealtime(dwell);
        }

        /// <summary>Calls a stock step, turning an exception into a route failure.</summary>
        private bool Do(string step, Action action)
        {
            _step = step;
            Debug.Log($"{Tag}step {step}");
            try
            {
                action();
                return true;
            }
            catch (Exception e)
            {
                _failure = (e is TargetInvocationException t ? t.InnerException ?? e : e).ToString();
                return false;
            }
        }

        private static object Call(object target, string method, params object[] args)
        {
            var type = target as Type ?? target.GetType();
            var m = type.GetMethod(method, BindingFlags.Instance | BindingFlags.Static | BindingFlags.Public | BindingFlags.NonPublic, null, args.Select(a => a.GetType()).ToArray(), null)
                ?? throw new MissingMethodException(type.FullName, method);
            return m.Invoke(target is Type ? null : target, args);
        }

        // Load button of the main menu's load dialog, after the dialog's own checks.
        private IEnumerator LoadSave()
        {
            if (!Do("load save", () => Call(FindObjectOfType<MainMenu>() ?? throw new InvalidOperationException("no MainMenu"), "OnLoadDialogFinished", _save)))
                yield break;
            yield return Wait("space center", () => Ready(GameScenes.SPACECENTER), dwell: 5);
        }

        // Click on the VAB.
        private IEnumerator EnterVab()
        {
            _editorStarted = false;
            if (!Do("enter VAB", () => (FindObjectOfType<VehicleAssemblyBuilding>() ?? throw new InvalidOperationException("no VAB building")).EnterBuilding()))
                yield break;
            yield return Wait("editor", EditorReady, dwell: 0);
        }

        private bool EditorReady() =>
            _editorStarted && HighLogic.LoadedScene == GameScenes.EDITOR && EditorLogic.fetch != null &&
            EditorDriver.fetch != null && !EditorDriver.fetch.restartingEditor;

        // Craft browser: load the stock Kerbal X. Skips only the browser's
        // craft upgrade pipeline, which a stock craft does not need.
        private IEnumerator LoadCraft()
        {
            _editorStarted = false;
            var path = KSPUtil.ApplicationRootPath + "Ships/VAB/Kerbal X.craft";
            if (!Do("load craft", () => EditorLogic.LoadShipFromFile(path))) yield break;
            yield return Wait("craft", () => EditorReady() && EditorLogic.fetch.ship != null && EditorLogic.fetch.ship.parts.Count > 0, dwell: 5);
            if (_failure == null && CrewAssignmentDialog.Instance == null) _failure = "no CrewAssignmentDialog: the launch would carry no crew";
        }

        // Launch button. A failed pre-flight check opens a "TestWarning" dialog
        // (e.g. a vessel left on the pad): that is a failure, never answered.
        private IEnumerator Launch()
        {
            _flightReady = false;
            if (!Do("launch", () => EditorLogic.fetch.launchVessel())) yield break;
            yield return Wait("flight", () =>
            {
                if (GameObject.Find("TestWarning dialog handler") != null) _failure = "a pre-flight check failed (see [Pre-Flight Check] lines)";
                var v = FlightGlobals.ActiveVessel;
                return _flightReady && HighLogic.LoadedScene == GameScenes.FLIGHT && v != null && v.loaded && !v.packed;
            }, dwell: 10);
        }

        // Esc, then Space Center: the pause menu saves and leaves when the vessel
        // may be saved (a fresh vessel on the pad may).
        private IEnumerator FlightToSpaceCenter()
        {
            if (!Do("leave flight", () =>
            {
                var status = FlightGlobals.ClearToSave();
                if (status != ClearToSaveStatus.CLEAR) throw new InvalidOperationException($"not clear to save: {status}");
                PauseMenu.Display();
                var menu = typeof(PauseMenu).GetField("fetch", BindingFlags.Static | BindingFlags.NonPublic)?.GetValue(null)
                    ?? throw new InvalidOperationException("no PauseMenu");
                GameEvents.onSceneConfirmExit.Fire(HighLogic.CurrentGame.startScene);
                Call(menu, "saveAndExit", GameScenes.SPACECENTER, HighLogic.CurrentGame.Updated());
            }))
                yield break;
            yield return Wait("space center", () => Ready(GameScenes.SPACECENTER), dwell: 5);
        }

        // Click on the Tracking Station.
        private IEnumerator EnterTrackingStation()
        {
            if (!Do("enter tracking station", () => (FindObjectOfType<TrackingStationBuilding>() ?? throw new InvalidOperationException("no Tracking Station building")).EnterBuilding()))
                yield break;
            yield return Wait("tracking station", () => Ready(GameScenes.TRACKSTATION), dwell: 5);
        }

        // Its "back to Space Center" button.
        private IEnumerator LeaveTrackingStation()
        {
            if (!Do("leave tracking station", () => (SpaceTracking.Instance ?? throw new InvalidOperationException("no SpaceTracking")).LeaveBtn.onClick.Invoke()))
                yield break;
            yield return Wait("space center", () => Ready(GameScenes.SPACECENTER), dwell: 5);
        }

        // Esc, then Main Menu: open the KSC pause menu as its button does, then
        // what its Main Menu button does (no confirmation).
        private IEnumerator SpaceCenterToMainMenu()
        {
            if (!Do("open space center menu", () => (UISpaceCenter.Instance ?? throw new InvalidOperationException("no UISpaceCenter")).quitBtn.onClick.Invoke()))
                yield break;
            yield return null;
            if (!Do("leave to main menu", () =>
            {
                if (!HighLogic.CurrentGame.Parameters.SpaceCenter.CanLeaveToMainMenu) throw new InvalidOperationException("the save does not allow leaving to the main menu");
                Call(KSCPauseMenu.Instance ?? throw new InvalidOperationException("no KSCPauseMenu"), "Dismiss");
                GamePersistence.SaveGame("persistent", HighLogic.SaveFolder, SaveMode.OVERWRITE);
                Call(typeof(HighLogic).Assembly.GetType("AnalyticsUtil", true), "LogSaveGameClosed", HighLogic.CurrentGame);
                HighLogic.LoadScene(GameScenes.MAINMENU);
            }))
                yield break;
            yield return Wait("main menu", () => Ready(GameScenes.MAINMENU), dwell: 5);
        }
    }
}
