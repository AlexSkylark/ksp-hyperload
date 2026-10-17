using System;
using System.Globalization;
using System.IO;
using System.Linq;
using KSP.UI.Screens;
using TMinus.Profiler;
using UnityEngine;

namespace TMinus.Report
{
    /// <summary>
    /// The player's side of the report (docs/m6-web-plan.md, "The player's
    /// journey"): after the Countdown, a screen message with its time and a
    /// T-Minus button on the stock toolbar, which KSP also shows in the main
    /// menu (AppScenes.MAINMENU) and keeps across scene changes. A click opens a
    /// small stock menu: write this session's report on a worker thread
    /// (<see cref="ReportWriter"/>) and open it in the browser, or turn measuring
    /// on or off from the next startup (<see cref="PlayerState"/>).
    /// Nothing here exists before the Countdown ends, and a report is written only
    /// on request (design rule 1).
    /// </summary>
    internal sealed class ReportService : MonoBehaviour
    {
        /// <summary>Sessions whose profiler records and reports are kept.</summary>
        private const int KeptSessions = 10;

        private const float MessageSeconds = 8;

        public static ReportService Instance { get; private set; }

        private string _template;
        private string _reports;
        private string _profilerDirectory;
        private string _log;
        private string _logSource;
        private Func<string> _jsonl;
        private Action _flush;

        private ReportWriter _job;
        private bool _openWhenDone;
        private bool _countdownEnded;
        private ApplicationLauncherButton _button;
        private Texture2D _icon;
        private PlayerState _state;
        /// <summary>Whether this session measures: the player's choice as it was at startup.</summary>
        private bool _measuring;
        private PopupDialog _menu;

        /// <param name="modFolder">GameData/000_TMinus.</param>
        /// <param name="workingDirectory">The process's working directory when T-Minus started: KSP opens "KSP.log" relative to it.</param>
        /// <param name="jsonl">This session's profiler records, or null when there are none.</param>
        /// <param name="flush">Writes what the profiler holds in memory to the records.</param>
        /// <param name="state">The player's choice for the next startup; this session measures.</param>
        public static ReportService Launch(GameObject host, string modFolder, string workingDirectory, Func<string> jsonl, Action flush, PlayerState state) =>
            Create(host, modFolder, workingDirectory, jsonl, flush, state, measuring: true);

        /// <summary>
        /// The player turned measuring off: no profiler, so the service finds the main
        /// menu itself, and its reports read KSP.log only.
        /// </summary>
        public static ReportService LaunchUnmeasured(GameObject host, string modFolder, string workingDirectory, PlayerState state)
        {
            var service = Create(host, modFolder, workingDirectory, () => null, () => { }, state, measuring: false);
            GameEvents.onLevelWasLoadedGUIReady.Add(service.OnSceneGuiReady);
            return service;
        }

        private static ReportService Create(GameObject host, string modFolder, string workingDirectory, Func<string> jsonl, Action flush, PlayerState state, bool measuring)
        {
            var service = host.AddComponent<ReportService>();
            service._template = Path.Combine(Path.Combine(modFolder, "Report"), "template.html");
            service._reports = Path.Combine(Path.Combine(modFolder, "PluginData"), "Reports");
            service._profilerDirectory = Path.Combine(Path.Combine(modFolder, "PluginData"), "Profiler");
            service._jsonl = jsonl;
            service._flush = flush;
            service._state = state;
            service._measuring = measuring;
            (service._log, service._logSource) = KspLogPath(workingDirectory);
            Instance = service;
            return service;
        }

        private void OnSceneGuiReady(GameScenes scene)
        {
            if (scene != GameScenes.MAINMENU)
                return;
            GameEvents.onLevelWasLoadedGUIReady.Remove(OnSceneGuiReady);
            CountdownEnded(ProfilerClock.ToMsSinceProcessStart(ProfilerClock.Now()) / 1000.0);
        }

        /// <summary>
        /// KSP opens "KSP.log" relative to the working directory it had at the time,
        /// which is usually, not always, the install's root (a shortcut's "Start in",
        /// a terminal on Linux or macOS).
        /// </summary>
        private static (string path, string source) KspLogPath(string workingDirectory)
        {
            if (!string.IsNullOrEmpty(workingDirectory))
            {
                var there = Path.Combine(workingDirectory, "KSP.log");
                if (File.Exists(there))
                    return (there, "working directory");
            }
            return (Path.Combine(KSPUtil.ApplicationRootPath, "KSP.log"), "install root");
        }

        /// <summary>Called once, when the main menu is ready: the Countdown is over.</summary>
        public void CountdownEnded(double secondsSinceProcessStart)
        {
            if (_countdownEnded)
                return;
            _countdownEnded = true;

            Debug.Log($"[TMinus] Report: button ready; KSP.log at {_log} ({_logSource})");
            var restart = ModuleManagerRebuiltCache()
                ? " ModuleManager patched from scratch and saved a new cache this time: the next startup is the typical one."
                : "";
            var next = _measuring
                ? " For the report, click the T-Minus button on the toolbar."
                : " Measuring is off: the T-Minus button on the toolbar writes a report from KSP.log only, or turns measuring back on.";
            Message($"T-Minus: Countdown {Clock(secondsSinceProcessStart)}.{restart}{next}", restart.Length > 0 || !_measuring ? 15 : MessageSeconds);
            Prune();

            // The launcher fires Ready once per scene; the button, once added, stays.
            GameEvents.onGUIApplicationLauncherReady.Add(AddToolbarButton);
            GameEvents.onGUIApplicationLauncherDestroyed.Add(ForgetToolbarButton);
            if (ApplicationLauncher.Ready)
                AddToolbarButton();
        }

        /// <summary>
        /// True when ModuleManager wrote its cache's hash file during this session.
        /// [C] MM rewrites GameData/ModuleManager.ConfigSHA only after patching from
        /// scratch with no errors (after errors it deletes it), and leaves it alone
        /// when it loads the cache. So a new file means this startup paid for an
        /// install change (or a first install) that the next one will not.
        /// </summary>
        private static bool ModuleManagerRebuiltCache()
        {
            try
            {
                var sha = Path.Combine(Path.Combine(KSPUtil.ApplicationRootPath, "GameData"), "ModuleManager.ConfigSHA");
                return ProfilerClock.ProcessStartKnown && File.Exists(sha) && File.GetLastWriteTimeUtc(sha) >= ProfilerClock.ProcessStartUtc;
            }
            catch (Exception)
            {
                return false;
            }
        }

        /// <summary>
        /// Writes the report; when <paramref name="open"/>, opens it in the browser.
        /// False when a report is already being written or the Countdown is not over.
        /// </summary>
        public bool Request(bool open)
        {
            if (!_countdownEnded)
                return false;
            if (_job != null)
            {
                Message("T-Minus: the report is still being written.");
                return false;
            }

            try
            {
                _flush();
                var jsonl = _jsonl();
                var name = SessionName(jsonl);
                var outPath = Path.Combine(_reports, $"tminus-{name}.html");
                if (!File.Exists(_template))
                    throw new FileNotFoundException($"the report template is missing ({_template}); reinstall T-Minus");
                _job = new ReportWriter(_template, _log, jsonl, outPath, name);
                _openWhenDone = open;
                _job.Start();
                Message("T-Minus: writing the report…", 3);
                return true;
            }
            catch (Exception e)
            {
                Fail($"{e.GetType().Name}: {e.Message}");
                return false;
            }
        }

        public bool Busy => _job != null;

        /// <summary>The last report's path, or null when the last request failed or none was made.</summary>
        public string LastReport { get; private set; }

        private void Update()
        {
            if (_job == null || !_job.Done)
                return;

            var job = _job;
            _job = null;
            if (job.Error != null)
            {
                Fail(job.Error);
                return;
            }

            LastReport = job.OutPath;
            Debug.Log($"[TMinus] Report: wrote {job.OutPath} ({Kb(job.PageBytes)}; KSP.log {Kb(job.LogBytes)}, profiler records {Kb(job.JsonlBytes)})");
            if (!_openWhenDone)
                return;
            Application.OpenURL(new Uri(job.OutPath).AbsoluteUri);
            Message($"T-Minus: the report opened in your browser (Alt+Tab if the game is full screen). Saved in GameData/000_TMinus/PluginData/Reports/{Path.GetFileName(job.OutPath)}.", 12);
        }

        private void Fail(string error)
        {
            LastReport = null;
            Debug.LogError($"[TMinus] Report: could not write the report ({error})");
            Message($"T-Minus: could not write the report ({error}). Details in KSP.log.", 12);
        }

        /// <summary>The session's name: its profiler records' time stamp ("run-20261016-205836.jsonl").</summary>
        private static string SessionName(string jsonl)
        {
            var file = jsonl == null ? null : Path.GetFileNameWithoutExtension(jsonl);
            if (file != null && file.StartsWith("run-", StringComparison.Ordinal))
                return file.Substring(4);
            return ProfilerClock.ProcessStartUtc.ToLocalTime().ToString("yyyyMMdd-HHmmss", CultureInfo.InvariantCulture);
        }

        /// <summary>Keeps the last <see cref="KeptSessions"/> sessions' records and reports; their names sort by time.</summary>
        private void Prune()
        {
            var current = _jsonl();
            var reports = _reports;
            var profiler = _profilerDirectory;
            System.Threading.ThreadPool.QueueUserWorkItem(_ =>
            {
                try
                {
                    PruneFiles(profiler, "run-*.jsonl", current);
                    PruneFiles(reports, "tminus-*.html", null);
                }
                catch (Exception)
                {
                    // Housekeeping only: a file in use or a missing folder waits for the next session.
                }
            });
        }

        private static void PruneFiles(string directory, string pattern, string keep)
        {
            if (!Directory.Exists(directory))
                return;
            var old = Directory.GetFiles(directory, pattern).OrderByDescending(f => Path.GetFileName(f), StringComparer.Ordinal).Skip(KeptSessions);
            foreach (var file in old)
            {
                if (keep != null && string.Equals(Path.GetFullPath(file), Path.GetFullPath(keep), StringComparison.OrdinalIgnoreCase))
                    continue;
                try { File.Delete(file); }
                catch (IOException) { }
                catch (UnauthorizedAccessException) { }
            }
        }

        private void AddToolbarButton()
        {
            if (_button != null || ApplicationLauncher.Instance == null)
                return;
            if (_icon == null)
                _icon = Icon();
            _button = ApplicationLauncher.Instance.AddModApplication(
                OnToolbarClick, OnToolbarClick, null, null, null, null,
                ApplicationLauncher.AppScenes.MAINMENU | ApplicationLauncher.AppScenes.SPACECENTER | ApplicationLauncher.AppScenes.VAB | ApplicationLauncher.AppScenes.SPH
                | ApplicationLauncher.AppScenes.FLIGHT | ApplicationLauncher.AppScenes.MAPVIEW | ApplicationLauncher.AppScenes.TRACKSTATION,
                _icon);
        }

        private void ForgetToolbarButton() => _button = null;

        /// <summary>The button opens (or closes) the menu; it never stays pressed.</summary>
        private void OnToolbarClick()
        {
            _button?.SetFalse(false);
            if (_menu != null)
            {
                _menu.Dismiss();
                _menu = null;
                return;
            }
            _menu = PopupDialog.SpawnPopupDialog(new Vector2(0.5f, 0.5f), new Vector2(0.5f, 0.5f),
                new MultiOptionDialog("TMinusMenu", MenuStatus(), "T-Minus", HighLogic.UISkin, 360f,
                    new DialogGUIButton("Write the report", () => { _menu = null; Request(true); }, true),
                    new DialogGUIButton(_state.Measuring ? "Turn measuring off" : "Turn measuring on", () => { _menu = null; ToggleMeasuring(); }, true),
                    new DialogGUIButton("Close", () => _menu = null, true)),
                false, HighLogic.UISkin, false);
        }

        /// <summary>What this session measures and what the next startup will.</summary>
        private string MenuStatus()
        {
            const string restart = "Restart KSP to measure the Countdown and the Holds: the profiler starts with the game.";
            if (_measuring)
                return _state.Measuring
                    ? "Measuring: on. The report covers the Countdown and every Hold so far."
                    : "Measuring: on for this session, off from the next startup.";
            return _state.Measuring
                ? "Measuring: off for this session, on from the next startup. The report reads KSP.log only. " + restart
                : "Measuring: off. The report reads KSP.log only. Turn measuring on, then restart KSP to measure the Countdown and the Holds.";
        }

        private void ToggleMeasuring()
        {
            var on = !_state.Measuring;
            if (!_state.Save(on))
            {
                Message("T-Minus: could not save the setting. Details in KSP.log.", 12);
                return;
            }
            Debug.Log($"[TMinus] Measuring: turned {(on ? "on" : "off")} from the next startup (PluginData/State.cfg)");
            if (on == _measuring)
                Message($"T-Minus: measuring stays {(on ? "on" : "off")}.");
            else if (on)
                Message("T-Minus: measuring is on from the next startup. Restart KSP to measure the Countdown and the Holds.", 12);
            else
                Message("T-Minus: measuring is off from the next startup; this session stays measured. The button still writes a report from KSP.log.", 12);
        }

        private void OnDestroy()
        {
            GameEvents.onLevelWasLoadedGUIReady.Remove(OnSceneGuiReady);
            GameEvents.onGUIApplicationLauncherReady.Remove(AddToolbarButton);
            GameEvents.onGUIApplicationLauncherDestroyed.Remove(ForgetToolbarButton);
            if (_menu != null)
                _menu.Dismiss();
            if (_button != null)
                ApplicationLauncher.Instance?.RemoveModApplication(_button);
            if (Instance == this)
                Instance = null;
        }

        /// <summary>The toolbar icon, drawn here so T-Minus adds no texture to GameDatabase: a "T" and a minus sign.</summary>
        private static Texture2D Icon()
        {
            const int size = 38;
            var icon = new Texture2D(size, size, TextureFormat.ARGB32, false);
            var clear = new Color(0, 0, 0, 0);
            var pixels = Enumerable.Repeat(clear, size * size).ToArray();
            void Fill(int x0, int y0, int x1, int y1)
            {
                // Rows count from the top here; Unity's from the bottom.
                for (var y = y0; y < y1; y++)
                    for (var x = x0; x < x1; x++)
                        pixels[(size - 1 - y) * size + x] = Color.white;
            }
            Fill(4, 7, 22, 12);   // T: bar
            Fill(10, 12, 16, 31); // T: stem
            Fill(22, 18, 34, 22); // minus
            icon.SetPixels(pixels);
            icon.Apply();
            return icon;
        }

        internal static void Message(string text, float seconds = MessageSeconds) =>
            ScreenMessages.PostScreenMessage(text, seconds, ScreenMessageStyle.UPPER_CENTER);

        /// <summary>"T–04:44", as the report writes the Countdown.</summary>
        private static string Clock(double seconds)
        {
            var whole = (int)Math.Round(seconds);
            return $"T–{whole / 60:00}:{whole % 60:00}";
        }

        private static string Kb(long bytes) => (bytes / 1024).ToString(CultureInfo.InvariantCulture) + " KB";
    }
}
