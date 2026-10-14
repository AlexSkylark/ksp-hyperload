# Benchmark results

Every measurement on `KSP-bench`, newest last. Record date, HyperLoad commit
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
