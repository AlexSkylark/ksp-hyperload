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

## Automated runs (KSP-dev, KSP-scenario, KSP-bench)

Automated runs on KSP-dev, KSP-scenario and KSP-bench play the same route by themselves:

```powershell
.\tools\run\Invoke-Run.ps1 -Install dev
.\tools\run\Invoke-Run.ps1 -Install scenario -Set @{ harmonyCallHooks = 'true' }
```

What the script does:
1. Builds the solution and the analyzer.
2. Deploys `000_TMinus\Plugins` and the route driver.
3. Writes `Settings.cfg` in three layers: the repo's file, then the install's
   own switches (KSP-scenario: `patchInventory = true`), then `-Set`.
4. Restores the save from its snapshot.
5. Starts `KSP_x64.exe -tminus-route` and waits for it to quit.
6. Archives the run with `conditions.txt` (commit, switches, route result) and
   `report.md`.
7. Prints this run's `check-archived` line.

It exits with 1 when the route failed or the run fails its expectations. Keep
the machine idle while it runs.

- **Route driver.**
  - The driver is `src/TMinus.Route`, built into `GameData/TMinusRoute`. It is
    dev-only and never part of a release.
  - It does nothing unless KSP is started with `-tminus-route`.
  - Each step calls the method the stock button calls, private ones by
    reflection, so the game does the same work as for a click. The one
    exception is the craft: it loads with `EditorLogic.LoadShipFromFile`,
    which skips the craft browser's upgrade pipeline. A stock craft does not
    need that pipeline.
  - It waits for each scene's ready event, then the waits above.
  - On a problem (a step not ready after 30 min, an exception, a pre-flight
    check failing) it writes `[TMinusRoute] FAILED <step>: <why>` to
    `KSP.log` and quits.
  - The analyzer counts `TMinusRoute` as T-Minus, not as a mod.
- **Save snapshots.** `D:\KSP\dev-saves\hyperload-dev` and
  `D:\KSP\scenario-saves\hyperload-dev`, made 2026-10-16 from each install's
  save:
  - The vessel the manual runs had left on the pad was removed. A launch with a
    vessel on the pad stops at the `LaunchSiteClear` pre-flight check.
  - Its crew (Jebediah, Bill, Bob) was set back to `Available`. Crew that is
    `Assigned` to no vessel would be set `Missing`.
- **KSP-bench** (`-Install bench`, Alex, 2026-10-16): the bench stays
  frozen, with `GameData\TMinusRoute` as a second allowed folder next to
  `000_TMinus`. The script deploys only those two, restores
  `saves\hyperload-bench` from `D:\KSP\bench-saves\hyperload-bench` and
  archives to `D:\KSP\bench-runs`. Automated and manual runs are never mixed
  in one comparison series: the waits are the same, the pace of the clicks
  is not. Manual series still use `Prepare-BenchRun.ps1`.
- The TMinus build also copies the repo's `Settings.cfg` over KSP-dev's. The
  script rewrites it on every run, so switches never carry over from an
  earlier run.

## Run types

| Type | Script | Use |
|---|---|---|
| Timing | `Prepare-BenchRun.ps1` | Profiler on. The default for measurements. |
| Overhead baseline | `Prepare-BenchRun.ps1 -Profiler Off` | T-Minus loads but records nothing. Compare with timing runs using KSP's own log lines. |
| Without Start hooks | `Prepare-BenchRun.ps1 -NoStartHooks` | Per-addon `Start()` timing off. It has been on by default since 2026-10-16 (cost ~0.7 s per session); earlier timing runs had it off, and before that date `-StartHooks` turned it on for diagnostic runs. Compare runs only with the same setting. |
| Switch | `Prepare-BenchRun.ps1 -Set @{ coroutineCensus = 'true' }` | Turns on an off-by-default group from `Settings.cfg` (here: the coroutine census, counts only). A diagnostic too: don't use its times as benchmark results. |

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
npm --prefix tools/analyze ci          # once: installs TypeScript
npm --prefix tools/analyze run build   # after every change to tools/analyze/src
node tools/analyze/dist/cli/analyze.js D:\KSP\bench-runs\<run> [D:\KSP\bench-runs\<run> ...]
```

Needs Node 24+. TypeScript is the only (dev) dependency. The source is in
`tools/analyze/src`:
- `core/`: parsers and model;
- `report/`: Markdown;
- `cli/`: file I/O.

`core/` and `report/` use no Node APIs, so a web page can reuse them. It
prints a Markdown report:
- **Per run:** conditions and the input level (`KSP.log` only; `KSP.log`
  with the profiler's `[TMinus] Summary` blocks; or with the profiler's
  `.jsonl`; and what the missing input would add). `--log-only` ignores the
  `.jsonl`, to see what a player's `KSP.log` alone gives; the
  **findings**, largest cost first, each with its cost, evidence, action and
  confidence; the Countdown (phases, loaders, assets per file
  and folder from the `Load` lines, long frames); each Hold with
  its long frames; the profiler's top aggregates (addon Awake/Start,
  GameEvents, ScenarioModules, parts by mod).
- **With several runs:** a comparison table, profiler on vs off. Holds into
  the space center and flight are compared through KSP's `ShowUI` line,
  which exists in both modes.

Log-gap attribution is a heuristic. A gap is time between two log lines, so
the work happened after the first and before the second. Check the raw
`KSP.log` before quoting a number.

Checks after changing the analyzer:

```powershell
npm --prefix tools/analyze test   # builds, then unit tests on synthetic logs
node tools/analyze/dist/cli/check-archived.js D:\KSP\expectations.json
```

`check-archived.js` runs on the local archive (the logs are not in the
repo) and checks each run against an expectations file: what each install
is known to show, such as the findings Phase 1 established on KSP-bench, and
none on KSP-dev. The expectations describe one person's installs, so they
live next to the archive, not in the repo. The format (validated strictly:
an unknown key or an invalid regex is an error) is defined in
`tools/analyze/src/cli/expectations.ts`, and
`tools/analyze/test-fixtures/expectations.example.json` shows every key; a
unit test keeps that example working. For runs whose `KSP.log` has the
summary, it also checks that `KSP.log` alone gives the same findings as the
`.jsonl`.

Expectations are regression checks for the analyzer on known installs. They
never feed back into rules, thresholds or actions (design principle 6).

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
