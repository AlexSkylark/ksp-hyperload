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
