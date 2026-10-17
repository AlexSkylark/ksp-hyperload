# Benchmark results

> The project was called HyperLoad until 2026-10-15. Entries up to that date
> use the old name in commits, paths and log lines (`[HyperLoad]`).

Every measurement on `KSP-bench`, newest last. Record date, T-Minus commit
and conditions. "dirty" means the DLL was built with uncommitted changes on
top of that commit.

All times are in seconds. "Process time" means seconds since the KSP process
started, as measured by the HyperLoad profiler.

## 2026-10-14: first startups, profiler validation

These runs were made while developing the profiler (Phase 1, step 1). They
are reference points, not a controlled series.

Conditions shared by all runs:
- Machine: i5-12400, 48 GB RAM, RTX 4070.
- OS file cache warm: system uptime about 3 h.
- ModuleManager cold, cache not saved (patch errors, see
  `phase1-profiler-scope.md`). `PartDatabase.cfg` rebuilt on every run.
- KSPCF 1.41.1, PNG texture cache warm.
- Launch to main menu, no save loaded.

| Run (local time) | HyperLoad | GameDatabase `Assets loaded in` | MM `Waited ... for patching` | MM `Post patch ran in` | `Loading Systems: Elapsed` | MM `Total loading Time` | Main menu scene switch (process time) | Main menu GUI ready (process time) |
|---|---|---|---|---|---|---|---|---|
| 16:45 | not installed | 61.3 | 55.2 | 6.0 | 185.8 | 241.0 | — | — |
| 18:37 | `64eb27e` dirty | 63.8 | 57.2 | 7.3 | 191.9 | 255.2 | 218.8 | 277.5 |
| 18:46 | `00f87c2` dirty | 53.6 | 64.9 | 5.2 | 186.4 | 242.0 | 205.1 | 262.5 |
| 18:59 | `add29f0` dirty (step 2 hooks) | 56.9 | 67.8 | 5.6 | 195.4 | 254.7 | 216.0 | 276.0 |
| 19:11 | `e82ac27` dirty (eager Start hooks, **broke KCT init**: discarded) | — | — | — | — | — | — | 278.3 |
| 19:23 | `e82ac27` dirty (lazy Start hooks, diagnostic; **other heavy workload on the machine: times invalid**) | 58.3 | 71.6 | — | 220.7 | 303.9 | — | 327.6 |

Observations:
- **Main menu interactive about 57–59 s after the scene switch** in both
  profiled runs. Mods work in the main menu during that time, and no current
  report attributes it to anyone. This is the first target for per-addon
  attribution.
- **Profiler loader spans match KSP's own log lines.**
  - Run 18:37: `PostPatchLoader` = 64.4 s; MM wait + post patch = 64.42 s.
  - Run 18:46: `PartLoader` = 60.7 s, `PostPatchLoader` = 70.1 s.
- **Run-to-run variation is large.** GameDatabase 53.6–63.8 s, MM wait
  55.2–64.9 s. Single runs can't support performance claims: the benchmark
  protocol needs several runs per condition.
- **HyperLoad overhead not measured yet.** The comparison between
  `enabled = true` and `enabled = false` is pending.

### Run 18:59: first startup with step 2 hooks

**Cross-checks against KSPCF's `[KSPCF:FastLoader]` report**, which measures
independently:
- `gameDatabase.urlDir` = 11.312 s; KSPCF: `Configs reload done in 11.312s`.
- `CreatePartIcon` total = 6.814 s; KSPCF: `PartIcon compilation : 6.808s`.

**Config reads:** the second full GameData scan made 7289 `ConfigNode.Load`
calls on the main thread, 9.2 s in total, even with KSPCF's ConfigNodePerf
active.

**Part compilation:**
- `PartLoader` loader total: 62.8 s. `ParsePart`, summed over 1870 parts:
  38.1 s.
- Largest mods by `ParsePart` time: Squad 7.7 s, AirplanePlus 3.8 s,
  ReStockPlus 2.9 s, SquadExpansion 2.4 s.
- Main-thread drag cube work: only 0.95 s.
- [I] The remaining ~24 s are frames yielded by the compile coroutines.
  Not attributed yet.

**Addon `Awake` costs (`AddonLoader.StartAddon`):**

| Phase | Total | Most expensive addons |
|---|---|---|
| Instantly | 4.7 s | RocketSoundEnhancement 1.46 s, DistantObject 1.43 s, Shabby 0.39 s, LoadingTipsPlus 0.28 s, Scatterer 0.27 s |
| PSystemSpawn | 5.6 s | **Kopernicus.Injector 5.5 s** |
| Main menu | 1.5 s | KerbalKonstructs 1.0 s, DistantObject 0.2 s |

**Main menu:** GUI ready 60.0 s after the scene switch, but addon `Awake`
explains only 1.5 s of it.
- `KSP.log` has no lines for **43 s** after the main-menu addons start:
  10.8 s, then 32.3 s, between two `Material doesn't have a texture property
  '_MainTex'` errors, until `ResearchBodies,LoadDatabase`.
- [I] This is probably `Start()` or coroutine work in main-menu addons, which
  per-addon `Start` timing (step 4) would attribute.

### Runs 19:11 and 19:23: per-addon `Start()` (diagnostic)

**Run 19:11 is invalid.** The first implementation patched every addon's
`Start` at startup.
- [C] Harmony compiles a method when it patches it. [I] That ran mods' static
  constructors early.
- `KerbalConstructionTime.KCT_Events` failed to initialize, and KSPe and KRASH
  initialized earlier than usual (compare `Player.log` with
  `Player-prev.log`).
- The group is now lazy, opt-in and off by default.

**Run 19:23 used lazy patching.** Init order matched the run without these
hooks: KSPe at the same position, no type initializer errors.

`long frame` detector: the main menu blocks in **one frame of 63.4 s** in this
run, and 49.0 s in run 19:11.

Addon `Start()` totals:

| Phase | Total | Most expensive |
|---|---|---|
| Loading (Instantly) | 7.1 s | Shabby 4.2 s, KSPCF NoIVA 2.1 s, SoundtrackEditor GuiManager 0.3 s |
| Main menu | 53.4 s | **ProgressiveCBMaps.VisualMaps 48.9 s**, JanitorsCloset.AssetsDatabase 1.9 s, Deferred 1.2 s, JanitorsCloset.GetInternalSpaceConfigUrl 0.5 s |

**Main finding: `ProgressiveCBMaps.VisualMaps.Start()` is the main-menu
stall.** In this run it took 48.9 s of the 63.4 s frame (times inflated, see
below). It explains most of the ~60 s between the scene switch and an
interactive main menu seen in the clean runs.

**Run 19:23 absolute times are invalid.** Alex was uploading large files from
another game during the run, which explains why it was slower overall
(`Loading Systems` 220.7 s vs 186–195 s, main menu frame 63.4 s vs 49.0 s).
Disk errors are ruled out too: no Event ID 51 since the 15:37 reboot.
- The attribution inside the run is still usable: VisualMaps is by far the
  largest `Start()`.
- Re-measure VisualMaps' absolute cost on a clean run before quoting a
  number.

Protocol lesson: benchmark runs need an otherwise idle machine. No uploads,
downloads, games or builds while KSP runs. This goes into the benchmark
protocol (step 5).

## 2026-10-15: first controlled series (startup + transitions, overhead)

Protocol: [protocol.md](protocol.md), standard run, save `hyperload-bench`
restored before each run (KCT disabled for the save). HyperLoad `0b45f9b`;
run 1 used a DLL stamped `316ad87`, built from the code later committed as
`763046f`, which is identical to `0b45f9b`. Machine idle, uptime 11–12 h (OS
file cache warm). Conditions alternated on, off, on, off... Raw logs:
`D:\KSP\bench-runs\20261015-*`.

| Run | Start | Profiler | Archive |
|---|---|---|---|
| 1 | 03:07 | on | `20261015-031604` |
| 2 | 03:18 | off | `20261015-032633` |
| 3 | 03:30 | on | `20261015-033751` |
| 4 | 03:38 | off | `20261015-034632` |
| 5 | 03:47 | on | `20261015-035536` |
| 6 | 03:56 | off | `20261015-040403` |
| 7 | 04:05 | diagnostic (`-StartHooks`) | `20261015-041352` |

### Profiler overhead (runs 1–6)

Only markers that exist with the profiler off are used:
- KSP's and ModuleManager's own log lines;
- the time of the `LOADING -> MAINMENU` scene switch since the first log
  line;
- for transitions into the space center and flight, the first
  `[UIMasterController]: ShowUI` after the scene switch. [C] It falls in the
  same millisecond (±5 ms) as the profiler's `LoadingBufferMask.Hide` marker.

| Metric | On: mean (range) | Off: mean (range) | Difference |
|---|---|---|---|
| `Loading Systems: Elapsed` | 188.2 (184.0–194.0) | 183.2 (182.8–183.7) | +5.0 s (+2.7 %) |
| MM `Total loading Time` | 242.5 (239.5–246.6) | 238.2 (237.7–239.0) | +4.3 s (+1.8 %) |
| Main menu scene switch | 203.5 (198.6–210.5) | 197.7 (197.3–198.3) | +5.8 s (+2.9 %) |
| Menu → KSC (ShowUI) | 16.13 | 16.01 | +0.1 s |
| VAB → flight (ShowUI) | 37.80 | 37.87 | −0.1 s |
| Flight → KSC (ShowUI) | 13.27 | 13.38 | −0.1 s |
| Tracking station → KSC (ShowUI) | 2.67 | 2.60 | +0.1 s |

- **Transitions: no measurable overhead.** The differences are within ±0.2 s,
  inside the run-to-run spread.
- **Startup: about +2 to +5 s (1–3 %).**
  - Run 1, the first of the session, is the slowest in every startup metric.
    Without it, the "on" means are 185.3 / 240.4 / 200.0, which is about
    +2.2 s (~1 %) over "off".
  - The "off" runs are very tight (0.9 s range).
  - Three runs per side can't separate a ~2 s overhead from noise. This is
    above the < 1 % target, or at its edge. Candidates:
    - per-call cost of the high-volume hooks: `ConfigNode.Load` (~7300
      calls), the `PartLoader` methods (~1900 calls each);
    - per-frame polling of the loading screen.
  - Measure with hook groups toggled off before optimizing.

### Startup and transitions with the profiler on (runs 1, 3, 5)

| Phase | Mean | Range |
|---|---|---|
| Main menu ready, since process start | 264.7 | 259.7–272.6 |
| Main menu ready, since the scene switch | 57.8 | 57.3–58.2 |
| Main menu → space center | 16.16 | 15.80–16.88 |
| Space center → VAB | 6.94 | 6.91–6.97 |
| VAB → flight | 37.98 | 37.27–38.65 |
| Flight → space center | 13.33 | 13.18–13.43 |
| Space center → tracking station | 4.14 | 4.08–4.20 |
| Tracking station → space center | 2.82 | 2.72–2.87 |
| Space center → main menu | 7.31 | 7.21–7.38 |

Transitions are very repeatable: under ±1 s, mostly ±0.2 s.

Space center times include stock's fixed ~2 s wait before
`LoadingBufferMask.Hide`.

**VAB → flight is dominated by one frame:** 33.1 s in run 5. Inside it, the
profiler only attributes about 1.8 s:
- buffered load step: 0.41 s;
- `Flight` addons' Awake: 1.08 s;
- `Game.Load`: 0.26 s;
- ScenarioModules: about 0.24 s (UnloadedResources 0.15 s).

[I] The remaining ~31 s is the flight scene's own startup (vessel and part
loading, planet setup), which no hook covers yet. Next target: vessel/part
hooks (step 4) and `FlightDriver`.

### Run 7 (diagnostic): per-addon `Start()`

Clean run, but with `addonStartHooks` on, so its absolute times are not
benchmark results. The main menu blocks in one frame of 50.5 s.

**`ProgressiveCBMaps.VisualMaps.Start()` = 41.2 s**, the single largest cost
found so far. It is about 70 % of the main menu's ~58 s from scene switch to
interactive.

Other notable `Start()` costs:
- Startup: Shabby 4.0 s, KSPCF NoIVA 1.8 s.
- Main menu: JanitorsCloset.AssetsDatabase 1.1 s, Deferred 1.0 s.
- Space center: FilterExtensions.LoadAndProcess (coroutine) 2.3 s,
  NightShiftCleanup 0.4–0.6 s.
- Flight: NavBallTextureChanger.TextureSelector 0.9 s, NightShiftCleanup
  0.8 s.

### Run 04:31 (2026-10-15): GameEvent dispatch timing

HyperLoad `550ea59` plus the uncommitted `GameEventHooks`. Archive:
`D:\KSP\bench-runs\20261015-043911`. 77 `Fire` methods were hooked, with no
errors; transitions stayed within the series range.

- **GameEvent handlers are not a major cost.** Over the whole session they
  total about 8 s. Largest totals: `onLevelWasLoaded` 2.4 s,
  `onLevelWasLoadedGUIReady` 1.6 s, `onEditorRestart` 1.5 s,
  `onGUIApplicationLauncherReady` 1.1 s. Largest single dispatch:
  `OnPSystemReady` 0.72 s.
- **ProgressiveCBMaps' ~15 s in the flight frame is not in any GameEvent
  dispatch.** Log-gap analysis (`tools/analyze`) attributes 14.2 s of the
  33 s VAB → flight frame to it, in 16 gaps between its
  `setVisualLevel` lines.
  - [I] Remaining candidates: a Unity callback (`SceneManager.sceneLoaded`),
    `Update` of a persistent object, or a component that isn't a
    `[KSPAddon]`.
  - None of these can be hooked at level 0 without patching the mod.

## 2026-10-15: KSP.log summary (M3b), validation on KSP-dev

T-Minus build of `0e01a2f` plus the Countdown header change committed as
`0d3d812` (the log line shows `0e01a2f`, the commit at build time). Stock
install, standard route (main menu → space center → VAB → flight → space
center → tracking station → space center → main menu). Archive:
`D:\KSP\dev-runs\20261015-184021`. Not a benchmark: it checks the summary,
not timings.

- One summary block at the main menu and one per Hold; no
  `summary failed` warning.
- The analyzer on KSP.log alone (`--log-only`, reading the summary) and on
  the `.jsonl` gives the same Countdown metrics, Holds, long frames with
  their log gaps, loaders, addon Awake and part totals, and the same
  findings (none, as expected on stock).
- What only the `.jsonl` has: the install conditions (KSPCF, MM cache),
  GameEvents, ScenarioModules, `partLoader.methods`, memory.
- Seen in this run and fixed after it (`ea9913b`): entries that round to
  0 ms were listed (`addon Awake (other) 0 ms, 9 calls`).

## 2026-10-16: M5 validation on KSP-bench (one run)

T-Minus `01f2d86` (summary format 3; module dispatch, Harmony patching,
assets per file), the first build on KSP-bench since the rename
(`000_HyperLoad` replaced by `000_TMinus`). Standard run, profiler on,
`harmonyCallHooks` off. It was the first KSP launch since the machine
booted. Archive: `D:\KSP\bench-runs\20261016-103746`. This is a validation
run, not a benchmark: there is one run, and its disk cache was cold.

- Main menu ready at 280.3 s after process start. Run 20261015-043911,
  the last run of a warm series, had 261.7 s.
  - The difference is in phases where no mod code runs: KSP start before
    the mod DLLs took 14.6 s against 7.0 s, and assets took 31.5 s against
    21.9 s.
  - The first runs of earlier sessions show the same thing: 20261014-234423
    took 14.7 s before the DLLs.
  - So the gap is the cold cache, not T-Minus. The profiler's overhead is
    not measured here (Alex's decision, see CLAUDE.md).
- The Holds are within 0.1 to 2.6 s of 20261015-043911. EDITOR->FLIGHT took
  38.74 s against 38.63 s.
- 28 findings (16 before). The new ones come from the new data:
  - module code: RocketSoundEnhancement 17.7 s, Ignition 2.8 s,
    MechJeb2 1.1 s;
  - Harmony patching: KSPCommunityFixes 1.7 s, informational;
  - asset loading: 6 GameData folders over 1 s each;
  - more ModuleManagerPostLoad and long-stall findings.
- `check-archived` passed:
  - KSP.log alone, read through the summary, gives the same findings as
    the `.jsonl`;
  - the bench suite gained checks gated by `when.summaryFormat` (new in
    `expectations.ts`).

## 2026-10-16: coroutine step timing on KSP-bench (one run)

Build `dced849` plus the uncommitted `coroutineHooks` work (committed right
after), automated route, `coroutineHooks = true`, against the run just
before it with the group off (`bench-runs/20261016-195421`, build
`7dc5744`). Archive: `D:\KSP\bench-runs\20261016-203341`. A validation run,
one per side: the times below show no difference larger than the noise, not
a measured overhead.

- Patching: T-Minus's own Harmony patching went from 440 rebuilds and
  1270 ms to 582 rebuilds and 1832 ms. That is about 0.56 s for 142 more
  methods: 140 coroutine types hooked plus the two `StartCoroutine`
  overloads. 12 types were skipped.
- Per step: 625,518 steps timed (16.6 s), 2,373 inside other timed code
  (2.0 s) and 65,136 loader steps (52.3 s). The cost of the prefix and
  postfix per step is not measured separately.
- Countdown T–04:37 on both runs. Holds 1:44 over 7 on both; EDITOR->FLIGHT
  41.2 s against 40.9 s.
- Findings: two new ones, ContractConfigurator 7.1 s
  (`FinalizeContractTypeLoad`, 1125 steps) and JanitorsCloset 1.0 s. One
  guess went away: the long frame in Editor → Flight attributed to
  ParallaxContinued, whose silence the measured steps now cover. `check-archived`
  ok, 33 findings.

## 2026-10-16: `coroutineHooks` on by default, revalidation (one run each)

Build `a5d401c`, automated route, repo defaults (`coroutineHooks` now on
without `-Set`). Archives: `D:\KSP\dev-runs\20261016-204735`,
`D:\KSP\scenario-runs\20261016-205033`, `D:\KSP\bench-runs\20261016-205836`.
`check-archived` ok on all three (dev 0 findings, scenario 3, bench 35).
A validation run, not an overhead series.

- Patching on the bench: 582 patches and 1872 ms of T-Minus's own Harmony
  patching over the session, against 582 and 1832 ms in the opt-in run
  above. Same methods; the 40 ms difference is within run-to-run noise.
- Countdown T–04:44 (T–04:37 on the two runs above); Holds 1:47 over 7
  (1:44); Editor → Flight 41.9 s (41.2 s). Single runs: these differences
  are not attributed to the default switch.
- Findings: the same titles as the opt-in run above.
- `Invoke-Run.ps1` had written this run's `report.md` (and four dev/scenario
  ones from today) decoded with the console's OEM code page, so arrows came
  out garbled. Fixed in the script (UTF-8 console output encoding before
  the analyzer call); the five reports were regenerated.

## 2026-10-16: Unity message timing on KSP-bench (one run)

Build `545ace1` plus the uncommitted `unityMessageHooks` code (and the
step 4 report writer), automated route, `-Set @{ unityMessageHooks = 'true' }`.
Archive: `D:\KSP\bench-runs\20261016-212255`; check-archived ok (39
findings). Compared with the `coroutineHooks` revalidation run above
(`20261016-205836`). Before it: KSP-scenario `20261016-210814` and KSP-dev
`20261016-211110`, both check ok. A validation run, not an overhead series.

- Patching on the bench: 891 patches and 2532 ms of T-Minus's own Harmony
  patching over the session, against 582 and 1872 ms: **+309 patches,
  +0.66 s**, the same order as `coroutineHooks` (+0.56 s). By the criterion
  set for this group (plan, "Unity messages: assessment and proposal"), the
  default becomes on.
- Dev (stock only): 157 patches, 864 ms against 152 and 858 ms; no message
  is patched there (stock-declared messages are skipped). Scenario: 13
  methods, all mod code (KSPCF, ModuleManager, RocketSoundEnhancement).
- Time measured in mods' messages: 11.5 s in the Countdown, 0.4–2.0 s per
  Hold, ~17 s over the session. The largest is
  `QuickStart.QLoading.OnGUI`, 9.4 s over 115,344 calls in the Countdown
  (a new measured finding, `expensive-unity-message`).
- Countdown T–04:47 (T–04:44); Holds 1:53 (1:47). Single runs: not
  attributed. Each timed call pays a clock pair; ~1.8 million message calls
  in the Countdown alone, so a part of these seconds is the timing itself.
- The route's end wrote the report through the mod (step 4);
  check-archived verified the archived `report.html`.

## 2026-10-16: `unityMessageHooks` on by default, revalidation (one run each)

Build `c7ec2b3` (step 4 included), automated route, repo defaults.
Archives: `D:\KSP\scenario-runs\20261016-212630`,
`D:\KSP\dev-runs\20261016-212926`, `D:\KSP\bench-runs\20261016-213723`.
`check-archived` ok on all three (scenario 3 findings, dev 0, bench 36),
each with its `report.html` verified (inputs block, embedded files are
prefixes of the archived ones, the page analyzes them). A validation run,
not an overhead series.

- Patching on the bench: 851 patches, 2512 ms (891 and 2532 ms in the
  opt-in run above). Message types are discovered lazily, so the count
  follows what the session instantiated.
- Countdown T–04:41 (T–04:47); Holds 1:53 (1:53).
- Findings: 36 against 39. The three missing ones (an addon Start, a
  `ModuleManagerPostLoad` callback and Scatterer's messages while loading)
  sat at 1.0 s, the rules' threshold, in the opt-in run; the rest differ by
  a few tenths. Single runs: not attributed.

## 2026-10-17: measuring on and off for the player (validation, one run each)

Build `9cce0c8` plus the uncommitted toggle (plan's "Measuring on and off"),
automated route, repo defaults.

- KSP-dev with `-MeasuringOff` (`D:\KSP\dev-runs\20261017-032225`): the
  bootstrap logged `Measuring: off`, applied no hook and wrote no `.jsonl`;
  the button still appeared and the route's report read KSP.log only
  (input level "log", with the "Measuring was off" notice). check-archived
  ok, 0 findings.
- KSP-dev measuring (`D:\KSP\dev-runs\20261017-032517`): State.cfg deleted
  by the script, log+profiler as before. check-archived ok, 0 findings.
- KSP-scenario measuring (`D:\KSP\scenario-runs\20261017-032812`):
  check-archived ok, 3 findings, as before.
- Not covered by the route: the toolbar menu itself (a stock popup) and the
  toggle writing State.cfg. Visual check for Alex in the plan.
