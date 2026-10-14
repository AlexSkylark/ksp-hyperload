# Phase 1: Profiler scope

Status: scope and architecture agreed on 2026-10-14. Architecture: see
"Profiler architecture" below.

Evidence labels: **[C]** confirmed in code or on disk, **[I]** inferred.

## Goal

Measure where startup and scene-transition time actually goes on `KSP-bench`,
with enough granularity to decide which HyperLoad optimizations are worth
building. No optimization work in this phase.

## Prior art: what KSPCommunityFixes already covers

Source: KSPCF README (master) cross-checked against the `ksp-reference` subagent.
Before building anything that touches these areas, check the KSPCF source.

| HyperLoad area (proposal) | Already covered by KSPCF |
|---|---|
| Asset loading | **FastLoader**: rewritten asset/part loader, multithreaded, not limited by GPU frame rate, **opt-in PNG→DXT5 texture cache** |
| Config lookups / parsing | **ConfigNodePerf**, **PersistentIConfigNode** |
| GameDatabase lookups | **GameDatabasePerf** (always on, dictionary-backed) |
| Localization cache | **LocalizerPerf** |
| Part compilation | **PartParsingPerf** (part icons, field parsing), **DragCubeGeneration** |
| DLC loading | **ExpansionBundlePreload**, **OptionalMakingHistoryDLCFeatures** |
| Editor indexes | **FasterEditorPartList**, **CraftBrowserOptimisations** |
| Scene transitions | **SceneLoadSpeedBoost** (save cached in memory), **ForceSyncSceneSwitch** (3→1 asset cleanups), **PQSOnlyStartOnce** |
| Memory | **MemoryLeaks** (GameEvents delegate cleanup on scene switch) |
| Reflection | **ReflectionTypeLoadExceptionHandler** patches `Assembly.GetTypes()` (error handling, not caching) |
| Profiling aids | **EventProfilerMarkers** (opt-in Unity Profiler markers on `EventData.Fire()`) |

### Answered questions (KSPCF 1.41.1 source, 2026-10-14)

**Can FastLoader be disabled via `Settings.cfg`? No.**

- [C] `KSPCFFastLoader` (`Performance/FastLoader.cs`) is its own
  `[KSPAddon(Instantly)]` MonoBehaviour, not a `BasePatch`. Its `Awake()` only
  checks the KSP version (≥ 1.12.3) and patches unconditionally. It also
  applies `GameDatabasePerf`, which is `[ManualPatch]` with `IgnoreConfig`.
- [C] `Settings.cfg` has no `FastLoader`, `ConfigNodePerf` or
  `GameDatabasePerf` key, and KSPCF reads no command-line arguments or
  environment variables.
- [C] Its only option is the PNG→DXT5 texture cache, stored in
  `PluginData/PNGTextureCache.cfg` (`userOptInChoiceDone`,
  `textureCacheEnabled`). Until the user answers the opt-in popup, asset
  loading waits.
- Consequence: "FastLoader off" is not a benchmark condition. The texture
  cache state (warm/cold) is.

**Does ConfigNodePerf miss the first config read? Yes.**

- [C] In `GameDatabase.LoadObjects` (state machine `<LoadObjects>d__90`), the
  first `new UrlDir(...)` parses every GameData `.cfg` **before**
  `AddonLoader.StartAddons(Instantly)`. That call is where `ConfigNodePerf`, an
  always-on Instantly addon, installs its `ConfigNode.Load/Parse/...`
  replacements.
- [C] The second full parse (the `new UrlDir` inside FastLoader's
  `FastAssetLoader`) and ModuleManager's cache/physics reads do go through
  ConfigNodePerf.
- [C] ModuleManager calls `ConfigNode.Load` from a background thread, so any
  hook there must be thread-safe.

**Which KSP methods does KSPCF patch?** Full table:
[kspcf-patch-targets.md](kspcf-patch-targets.md).

- [C] 131 patching units: 127 `BasePatch` classes plus 4 self-patching
  Instantly MonoBehaviours (FastLoader, ConfigNodePerf,
  ReflectionTypeLoadExceptionHandler, NoIVA). Roughly 400 Harmony patches.
- [C] Startup-relevant facts:
  - FastLoader's prefix on `GameDatabase.SetupMainLoaders` **throws** on
    purpose to kill the stock `LoadObjects` coroutine. Stock per-asset
    `DatabaseLoader`s never run.
  - Stock `PartLoader.CompileAll` is **never called**. A transpiler on
    `StartLoad` redirects it, but KSPCF still drives the stock
    `CompileParts` / `ParsePart`.
  - `ExpansionsLoader.StartLoad` is replaced, and DLC loading runs in
    parallel (`ExpansionBundlePreload`).
- [C] `BasePatch`es are applied from a ModuleManager post-patch callback:
  after GameDatabase and MM patching, before `PartLoader`.

### Actual configuration on KSP-bench (read from disk, 2026-10-14)

- [C] KSPCF 1.41.1 with shipped `Settings.cfg` defaults, plus MM overrides
  from other mods:
  - **`ForceSyncSceneSwitch = false`**, because UniversalStorage2 is
    installed (`KSPCommunityFixes/MMPatches/ModSupport/UniversalStorage.cfg`).
  - `MapSOCorrectWrapping`, `ScatterDistribution`, `ROCValidationOOR` = false
    (Kopernicus).
  - `DockingPortLockedEvents = true` (KerbalJointReinforcement).
- [C] Loading-relevant switches:
  - on: `SceneLoadSpeedBoost`, `DragCubeGeneration`, `PartParsingPerf`,
    `LocalizerPerf`, `ExpansionBundlePreload`, `PersistentIConfigNode`,
    `MemoryLeaks`;
  - off: `PQSOnlyStartOnce`, `EventProfilerMarkers`.
- [C] PNG texture cache: enabled, populated (1869 files).
- [C] **ModuleManager never writes its cache on the bench.** Four errors in
  `ChemicalPropulsion/Patches/Compatibility/chemical-propulsion-NearFutureSpacecraft.cfg`
  trigger `Errors in patch prevents the creation of the cache`. Every startup
  is therefore an MM cold run, and the cold path also deletes
  `PartDatabase.cfg` (`PartLoader: Creating part database`), so drag cubes
  are regenerated on every startup.

### Existing timings from one bench run (2026-10-14 16:45, before HyperLoad)

Sources: `[KSPCF:FastLoader]` report, stock and ModuleManager log lines in
`KSP.log`. Single run; reference only.

| Phase | Time |
|---|---|
| Configs + assemblies (first parse, unpatched) | 11.7 s |
| Second config parse | 9.8 s |
| Assets (1391 audio, 6674 textures, 3364 models) | 26.8 s |
| GameDatabase total (`Assets loaded in`) | 61.3 s |
| Waiting for MM patching (`Waited ... for patching`) | 55.2 s (MM ran 83.3 s, overlapped) |
| MM post-patch | 6.0 s |
| Parts: 1885 parts, 18102 modules (icons 6.1 s) | 61.2 s |
| `Loading Systems: Elapsed time` | 185.8 s |
| Planetary system | 13.1 s |
| KSPCF "total loading time to main menu" | 207.9 s |

[I] Mods keep working in the main menu for about 48 s after the scene
switch, until MM's `Total loading Time = 240.966s`. No existing report
attributes this time.

Areas with **no known coverage** (candidates, pending profiler data): plugin
assembly loading and `KSPAddon` instantiation, per-mod `Awake`/`Start` cost,
reflection caching, object/scene residency across transitions.

## What to measure

### Startup (launch → main menu)

- Plugin assembly loading (`AssemblyLoader`). Our DLL loads during this phase,
  so its start can only be estimated (process start time, `KSP.log` timestamps).
- ModuleManager patching, distinguishing **cold** (no MM cache) from **warm** (cache valid).
- GameDatabase loading, split by asset type where possible (textures, models, audio, configs).
- Part compilation (`PartLoader`), drag cubes, part icons.
- DLC/expansion loading.
- Time from loading screen end to main menu interactive.

### Scene transitions

For each transition pair (main menu→KSC, KSC→VAB, VAB→Flight, Flight→KSC, KSC→Tracking Station):

- Unload/cleanup of the previous scene (asset cleanup, GC).
- Save load/persistence.
- Unity scene load.
- Plugin startup: per-`KSPAddon` instantiation, `Awake`, `Start` time, attributed to its assembly.
- Time until the player regains control.

### Cross-cutting

- GC collections and managed heap before/after each phase.
- Per-mod attribution wherever a hook allows it: this is the data the Plugin
  Scheduler (Phase 6) will depend on.

## Benchmark conditions

Load times vary heavily with cache state, so every run records its conditions:

- **MM cache**: always cold on `KSP-bench` (see above). The profiler still
  detects cold/warm, so other installs are recorded correctly.
- **OS file cache**: first run after reboot vs repeated runs (recorded via
  system uptime).
- **KSPCF configuration**: as installed in `KSP-bench`. FastLoader cannot be
  toggled; the PNG texture cache state (warm/cold) is recorded.
- Same save, same craft, same transition script for every run.
- Each result recorded with date, HyperLoad commit, and conditions. Multiple runs per condition.

## Constraints on the profiler itself

- Optimization level 0: it must never change game behavior.
- Low overhead: `Stopwatch`-based timing, no per-frame allocations, buffered output.
- Its Harmony patches must not conflict with KSPCF's. Where FastLoader replaces a
  stock code path, instrument the path actually executed.
- Output to a structured file (one line per measurement, machine-readable) in
  addition to short summary lines in `KSP.log` with the `[HyperLoad]` prefix.
- Fails safe: if a hook can't be applied, log it and continue without that measurement.

## Profiler architecture

### Principles

- **Level 0 only.** Allowed: non-affecting prefixes at `Priority.First`
  (`__state`/`__instance`/value-type parameters only, no `bool` return, so
  they run even after another mod's skipping prefix), postfixes at
  `Priority.Last`, and finalizers. Not allowed: `return false`, transpilers,
  changing arguments.
- **Fail safe per hook.** Each hook applies inside `try/catch`. On failure it
  logs `[HyperLoad] Profiler: hook <id> unavailable (<reason>)` and the
  profiler continues without it.
- **Instrument the path that actually runs.** Every hook must work with and
  without KSPCF. No patches on FastLoader's private internals: the per-asset
  breakdown comes from the `[KSPCF:FastLoader]` report, parsed offline.
- **Low overhead.** Use `Stopwatch.GetTimestamp()` and struct events in a
  preallocated buffer. High-volume hooks (parts, modules, `ConfigNode.Load`)
  aggregate count, total and max per key instead of emitting one event per
  call. Output is written only at checkpoints: main menu, each scene ready,
  and exit.

### Components (`src/HyperLoad/Profiler/`)

| Component | Responsibility |
|---|---|
| `HyperLoadBootstrap` | Instantly `Awake`: read settings, create `Harmony("HyperLoad.Profiler")`, `DontDestroyOnLoad`, start the profiler |
| `ProfilerClock` | Anchors taken at `Awake` (process start time, `Time.realtimeSinceStartup`, UTC now, `Stopwatch`). All events are in ms since process start; time before our `Awake` is a "pre-profiler" span |
| `Recorder` | Spans, marks, counters; thread-safe (MM and KSPCF use worker threads), records the thread; per-key aggregators |
| `HookRegistry` / `IProfilerHook` | Each hook has an id, group, target and `TryApply(Harmony)`. Groups can be toggled in settings. Reports applied vs unavailable hooks |
| `LoadingScreenMonitor` | Logs `LoadingScreen.Instance.loaders` once, then polls `IsReady()` every frame to get per-loader wall time with no patching (covers MM's `PostPatchLoader` and `FontLoader`); also records frame stats during loading |
| `StartupHooks` | `StartLoad` prefixes; end events (`OnGameDatabaseLoaded`, `OnPartLoaderLoaded`, `OnExpansionSystemLoaded`, `OnUpgradesFilled/Linked`); `UrlDir` ctor; `translateLoadedNodes` (stock only); `PartLoader.ParsePart` (aggregate + top-N); `CreatePartIcon`; `DragCubeSystem.SetupDragCubeCoroutine` `MoveNext`; `LoadInternalProp/Space`; `ConfigNode.Load` (aggregated per thread); `GameDatabase.SetupMainLoaders` finalizer as a marker |
| `AddonHooks` | `AddonLoader.StartAddon` prefix/postfix: Awake+OnEnable per type/assembly/scene; whole `StartAddons` call (reflection cost). Optional group: per-addon `Start` via dynamic patches (`MoveNext` for coroutines) |
| `SceneTransitionTracker` | Start at `HighLogic.LoadScene` / `onGameSceneLoadRequested`. Milestones: `bufferedLoad` steps, `sceneLoaded`, `StartAddons`, `GamePersistence.LoadGame/SaveGame`, `Game.Load`, `ScenarioRunner.AddModule(ConfigNode)` per type, `onLevelWasLoaded`, `onLevelWasLoadedGUIReady`. Ready per scene (see table below). Records the first N frame times after ready |
| `VesselHooks` (optional, off by default) | `PartModule.Load`, `Part.ModulesOnStart` aggregated by module type and assembly; `ProtoVessel.LoadObjects` |
| `MemorySampler` | At each milestone: `GC.CollectionCount(0..2)`, `GC.GetTotalMemory(false)`, Unity `Profiler` memory counters. [I] Whether `CollectionCount` works on Unity 2019's Mono is unverified |
| `RunConditions` | Header record: KSP and HyperLoad versions (commit), mod/DLL list hash, KSPCF version, PNG cache state, MM cold/warm (`ModuleManager.ConfigSHA` and `PartDatabase.cfg` mtimes vs process start), system uptime |
| `JsonlWriter` | `GameData/000_HyperLoad/PluginData/Profiler/run-<timestamp>.jsonl`, one record per line, no dependencies. Short `[HyperLoad]` summary lines in `KSP.log` |
| Settings | `GameData/000_HyperLoad/Settings.cfg`, read directly with `ConfigNode.Load`: `profilerEnabled` plus one toggle per hook group |

"Ready" markers per scene:

| Scene | Ready marker |
|---|---|
| Main menu | `MainMenu.Start` postfix |
| KSC | `LoadingBufferMask.Hide` postfix; stock adds a fixed 2 s wait, record it separately |
| Editor | `GameEvents.onEditorStarted` |
| Flight | `LoadingBufferMask.Hide` (active vessel unpacked), plus `onFlightReady` |
| Tracking station | `SpaceTracking.Start` postfix, plus `onLevelWasLoadedGUIReady` |

Offline tooling (`tools/`) merges the `.jsonl` with `KSP.log` (stock,
ModuleManager and `[KSPCF:FastLoader]` timing lines) and compares runs.
Parsing logs offline avoids hooking the log at runtime: ModuleManager already
installs its own log handler.

### Known limits

- Assembly loading and the first config parse run before any mod code and
  cannot be hooked. They are covered by the pre-profiler span and KSPCF's
  report.
- Instantly addons created before ours are not measured. The mod folder is
  `000_HyperLoad` so that ours is created early.
  - [C] KSP-dev, 2026-10-14: ours is the 2nd Instantly addon, after
    `HarmonyInstallChecker`.
  - [C] Bench, from the `KSP.log` order before HyperLoad was installed:
    - We would be 5th of about 150. Only `ModuleManager` (DLL at the
      GameData root), `ClickThroughBlocker` (2 addons) and
      `Filter Extensions` come before us.
    - Dependencies reorder some assemblies (e.g. Kopernicus after
      ModularFlightIntegrator), so the order is not strictly alphabetical.
    - KSPCF's addons are created at positions 73–77, in this order:
      `KSPCommunityFixes`, `NoIVA`, `ConfigNodePerf`, `KSPCFFastLoader`.
      So ConfigNodePerf is already active when FastLoader reads
      `PNGTextureCache.cfg`.
- `VesselModule.Awake` runs before any addon ([C] `VesselModuleManager.CompileModules`)
  and is not measured.

### Implementation order

Each step is a small PR, tested on KSP-dev first.

1. Core: clock, recorder, writer, run conditions, settings, hook registry,
   loading-screen monitor, phase-end GameEvents, memory sampler.
2. Startup hooks and `AddonHooks` (Awake).
3. Scene transition tracker, ScenarioModules, ready markers.
4. Optional groups: `VesselHooks`, per-addon `Start`.
5. Analysis tooling and benchmark protocol (`docs/benchmarks/`).
