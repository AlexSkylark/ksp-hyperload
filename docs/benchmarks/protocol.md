# Benchmark protocol

How to produce comparable numbers on `KSP-bench`. Results go in
[results.md](results.md).

## Before every run

1. Close KSP if it is running.
2. Run `tools\bench\Prepare-BenchRun.ps1` with the right options (see
   "Run types" below). It restores the dedicated save, sets the profiler
   switches and prints the conditions to record.
3. Keep the machine idle until KSP is closed: no uploads, downloads, other
   games or builds. Run 19:23 on 2026-10-14 was invalidated by an upload.

## Standard run (startup + transitions)

Start a stopwatch-free run: the profiler and the logs give every time.

1. Launch `D:\KSP\KSP-bench\KSP_x64.exe`.
2. Wait for the main menu to respond, then **wait 10 s**.
3. **Start Game → Resume Saved → `hyperload-bench`**. Load it.
4. Space Center: when the UI is shown, wait 5 s, then enter the **VAB**.
5. VAB: load **Kerbal X** (Load button, VAB tab), wait 5 s, click **Launch**.
6. Flight: when the vessel is on the pad and controllable, wait 10 s.
7. **Esc → Space Center**. Wait 5 s.
8. Enter the **Tracking Station**. Wait 5 s. **Back to Space Center** (exit
   button). Wait 5 s.
9. **Esc → Main Menu**. Wait 5 s. **Quit**.

The fixed waits let the scene settle before the next transition. Don't click
anything else: popups from mods can be closed, but note them.

## Run types

| Type | Script | Use |
|---|---|---|
| Timing | `Prepare-BenchRun.ps1` | Profiler on. The default for measurements. |
| Overhead baseline | `Prepare-BenchRun.ps1 -Profiler Off` | T-Minus loads but records nothing. Compare with timing runs using KSP's own log lines. |
| Diagnostic | `Prepare-BenchRun.ps1 -StartHooks` | Per-addon `Start()` attribution. It patches mod code, so its absolute times **must not** be used as benchmark results. |

For overhead, compare the KSP and ModuleManager lines present in both modes:
- `Loading Systems: Elapsed time`;
- `[ModuleManager] Total loading Time`;
- the timestamps of the `[HighLogic] ... Scene Change` lines.

## How many runs

- At least **3 runs per condition**. Alternate conditions (on, off, on, off,
  ...) so that drift over the session affects both equally.
- Run-to-run variation is large on this machine. GameDatabase varied between
  53.6 and 63.8 s across single runs. Report mean and range, never a single
  run.
- OS file cache: the first run after a reboot is a separate condition (cold).
  `Prepare-BenchRun.ps1` prints the uptime.

## What to record

For each run, a row in [results.md](results.md) with:
- date and local start time;
- T-Minus commit (from the `[TMinus] T-Minus <version>+<commit>` log
  line);
- run type;
- conditions printed by the script;
- anything unusual: popups, a mod error dialog, other activity on the
  machine.

Logs are kept automatically. Before preparing a new run,
`Prepare-BenchRun.ps1` copies the previous run's `KSP.log`, `Player.log` and
profiler `.jsonl` to `D:\KSP\bench-runs\<time of that run>\`. KSP overwrites
its logs on every launch. After the last run of a session, run the script
once more (or copy the files by hand) so that run is archived too.

## Analysis

```powershell
node tools/analyze/analyze.mts D:\KSP\bench-runs\<run> [D:\KSP\bench-runs\<run> ...]
```

Node 24+ runs the TypeScript file directly; there is no build and no
dependency. It prints a Markdown report:
- **Per run:** conditions, startup and loaders, transitions, long frames with
  the log gaps inside them grouped by the mod that logged around each gap,
  and the top aggregates (addon Awake/Start, GameEvents, ScenarioModules,
  parts by mod).
- **With several runs:** a comparison table, profiler on vs off.
  Transitions into the space center and flight are compared through KSP's
  `ShowUI` line, which exists in both modes.

Log-gap attribution is a heuristic. A gap is time between two log lines, so
the work happened after the first and before the second. Check the raw
`KSP.log` before quoting a number.

## The benchmark save

`saves\hyperload-bench`: a sandbox game created on 2026-10-14, with `Kerbal X`
saved in the VAB. Reference copy: `D:\KSP\bench-saves\hyperload-bench`.
- **Kerbal Construction Time is disabled for this save** (`Enabled = False` in
  the save's `KCT_Settings.cfg`). With KCT active, Launch puts the vessel in a
  build queue instead of launching, which breaks the fixed script. KCT is
  still installed and loads at startup; only its per-save logic is inactive,
  so its transition costs are not part of these measurements.

## Fixed conditions on KSP-bench

These are not variables. They are the same in every run (see
`phase1-profiler-scope.md`):
- ModuleManager is always cold: its cache is never saved because of patch
  errors.
- KSPCF FastLoader is on, PNG texture cache warm.
- `ForceSyncSceneSwitch` is off (UniversalStorage2).
