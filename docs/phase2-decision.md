# Phase 2 decision: from optimizer to diagnostics

Status: decided on 2026-10-15.

Phase 1 measured where loading time goes on a 180-mod install (`KSP-bench`).
Phase 2 had to decide whether optimizing that time in our own code was worth
building. This document records the decision and the evidence behind it.

Labels:
- **[C]** measured, or read in code;
- **[I]** inferred.

## Decision

1. **No optimizations of our own.**
   - The ceiling for what this project could remove at optimization levels
     0–2 is small.
   - The largest share of it is already owned by KSPCommunityFixes.
   - The one target that is ours alone, rebuilding planet terrain between
     scenes, sits under the lifecycle hooks of at least seven mods.
2. **The project becomes a diagnostics tool** and is renamed from HyperLoad
   to **T-Minus**. It combines the in-game profiler with a log analyzer.
   - Its job is to tell a player what costs time on their install, and what
     to do about it.
   - Design: [design.md](design.md).
3. **Fixes we find go upstream**, as data or pull requests to the projects
   that own the code:
   - KSPCommunityFixes;
   - the mods themselves.

The original proposal ([proposal.md](proposal.md)) is kept as a historical
document.

## The question

The proposal planned persistent caches, persistent services and object
residency (optimization levels 0–2). The question was how much of the
measured time those levels could remove, and at what risk to compatibility.

All numbers come from existing runs, with no new benchmark runs:
- `KSP-bench`: the controlled series of 2026-10-15, mainly run 5
  (`D:\KSP\bench-runs\20261015-035536`);
- `KSP-dev` (stock plus DLCs, without KSPCF): one profiled run on 2026-10-14
  (`D:\KSP\dev-runs\20261014-232428`).

## Evidence

### 1. Stock work is a small share of transition time

The same transitions on stock and on the bench [C]:

| Transition | KSP-dev (stock) | KSP-bench | Difference |
|---|---|---|---|
| Main menu → space center | 6.6 s | 16.2 s | 9.6 s |
| VAB → flight | 7.8 s | 38.0 s | 30.2 s |
| Flight → space center | 6.7 s | 13.3 s | 6.6 s |

The stock column is a single run without KSPCF: read it as an order of
magnitude. It still bounds the problem. Entering flight on a stock install
takes 7.8 s in total, so keeping stock objects alive can only remove part of
that. The other ~30 s come from mods, or from stock steps that mods make
more expensive.

### 2. The startup ceiling is 2–3 %, and it sits inside KSPCF's code

Startup on the bench takes about 262 s:

| Cost | s | Addressable at levels 0–2? |
|---|---|---|
| ModuleManager patching with no cache | 65 | No. MM's own cache solves it (see 3) |
| ProgressiveCBMaps (ResearchBodies) in the main menu | 41 | No. Mod code (see 3) |
| Drag cube regeneration | ~18 | No. A side effect of the cold MM cache (see 3) |
| Rest of part compilation | ~42 | No. KSPCF already optimizes it; keeping part prefabs between sessions is not feasible |
| Second config parse | ~10 | In part. A cache might save 5–7 s [I], but this code path belongs to KSPCF's FastLoader |
| Assets, Kopernicus, Unity | ~50 | No |

### 3. The large costs are diagnosable, but not ours to optimize

- **ModuleManager cache never saved** [C]. MM saves its cache only when
  patching has no errors.
  - The bench has 4 errors, all from one file:
    `ChemicalPropulsion/Patches/Compatibility/chemical-propulsion-NearFutureSpacecraft.cfg`.
    The file copies `chemTechTankVolumePropellant` and
    `chemTechTankMassPropellant` on 4 parts, but 2 of those parts don't have
    the keys.
  - Every startup is therefore MM cold, and MM's cold path also deletes
    `PartDatabase.cfg`.
  - The same file is unchanged on ChemicalPropulsion's `main` branch, and no
    open issue reports it.
- **Drag cubes regenerated every startup** [C]. 1,650 parts log `Creating
  drag cubes` in every run, because `PartDatabase.cfg` is missing.
  - KSPCF's part compile loop yields a frame every 33 ms, or whenever
    `DragCubeGeneration` asks for one.
  - [I, strong] This explains most of the ~18 s of part compilation that
    Phase 1 could not attribute. It disappears once the MM cache is saved.
- **ProgressiveCBMaps (part of ResearchBodies) in the main menu: 41 s** [C].
  - `CelestialBodyInfo`'s constructor runs once per celestial body.
  - Each time, it fills a blank bump-map texture as large as the original
    with one `SetPixel` call per pixel.
  - Filling it in one call would remove nearly all of this.
  - The mod has been inactive since 2022. Its author already answered a slow
    loading report in 2017 (issue #30) that the cost is inherent to how the
    mod works.
- **ProgressiveCBMaps on flight entry: ~14 s, at least partly an artifact of
  the bench** [I].
  - The mod caches its scaled maps per save, in `saves/<save>/ResearchBodies/`.
  - Our bench script restores the save with `robocopy /MIR` before every run,
    which deletes that cache.
  - The flight-entry cost with a warm cache was not measured.

### 4. The stock transition targets already belong to KSPCF

| Candidate | Cost on the bench | What it is [C] | Owner and status | Risk |
|---|---|---|---|---|
| Buffered (async) scene switch | 4–7 s per transition (figures from KSPCF PR #250 on a large modpack) | `HighLogic.bufferedLoad` loads an intermediate scene, then runs `UnloadUnusedAssets` and `GC.Collect`. Asset cleanup runs three times instead of once | KSPCF `ForceSyncSceneSwitch`. Turned off on installs with UniversalStorage2 (KSPCF #273) | Solved, except with US2 |
| Fixed 2 s wait on space center entry | 2.0–2.2 s per entry | `LoadingBufferMask.ShowDuration()` waits 75 frames, then `WaitForSeconds(2f)` unconditionally, in SPACECENTER only | Removed as a side effect of `ForceSyncSceneSwitch` | Low [I] |
| Kerbin terrain built twice on launch | ~2.3 s | `FlightDriver.setStartupNewVessel` force-starts the launch site's terrain, then `SetPQSActive()` resets every sphere | KSPCF `PQSOnlyStartOnce`. Off by default since 1.40.1 (KSPCF #351: terrain fails to load with SigmaDimensions; cause unknown) | Medium–high |
| Terrain rebuilt on every space center entry | 1.8–2.2 s | Terrain objects persist (`DontDestroyOnLoad`), but `StartSphere` destroys and rebuilds every quad | Nobody. This is the only true level-2 target | High (see 5) |

On bench-specific numbers:
- On the bench, the "Update Quads Init" lines come from ParallaxContinued,
  which does its own work inside each terrain build.
- Phase 1 labeled this cost "Kerbin ocean PQS init". It is the Kerbin
  terrain build.

### 5. Many mods depend on the terrain lifecycle

Names of PQS lifecycle methods found in the bench's mod DLLs [C, names only;
how each mod uses them is inferred]:

| Mod | References |
|---|---|
| Kopernicus | `OnSphereReset`, `OnSphereStarted`, `OnSphereActive`/`Inactive`, `OnQuadBuilt`, `OnQuadPreBuild`, `ResetSphere`, `RebuildSphere`, `ResetAndWait`, `StartSphere`, `DeactivateSphere` |
| ParallaxContinued | `OnQuadBuilt`, `OnQuadPreBuild`, `RebuildSphere`, `onPQSUnload` |
| Scatterer | `OnSphereActive`, `OnSphereStarted`, `DeactivateSphere` |
| EnvironmentalVisualEnhancements | `OnSphereActive`, `OnSphereInactive`, `OnSphereStarted` |
| ProgressiveCBMaps | `ActivateSphere`, `DeactivateSphere` |
| SCANsat | `OnQuadPreBuild`, `OnSphereInactive` |
| KerbalKonstructs | `RebuildSphere` |

Skipping or reusing a terrain build means each of these mods sees one
lifecycle event fewer.
- [I] KSPCF #351 is most likely this kind of failure.
- Validating such an optimization would need these mods' sources, which this
  project does not track.

### 6. The community already knows the mechanisms

None of the mechanisms above is new to KSP modders:
- **KSPCF #275** (Investigate scene switch loading times, 2024) profiled a
  flight-to-flight transition with DotTrace. It concludes that stock times
  are "relatively acceptable" and that the bigger problems are in mods.
- **KSPCF #271** profiled terrain (PQS) costs in detail.
- Every mechanism has its own issue or pull request:
  - MM cache;
  - drag cubes;
  - `ForceSyncSceneSwitch` (#250, #273);
  - `PQSOnlyStartOnce` (#350, #351).

What we could not find is a tool that tells a **player** which of these
apply to their own install, and what each one costs there:
- KSPModdingLibs' KSPProfiler measures the in-game frame loop, not loading
  or transitions. It has had no release since February 2024.
- KSPCF's FastLoader reports loading phases, not costs per mod.
- Forum advice relies on reading `KSP.log` by hand or removing mods one by
  one.
- Our search covered GitHub, SpaceDock and the web. It did not cover the KSP
  forum in depth (some pages blocked automated access) or Discord.

## Alternatives considered

| | (a) Optimize in our own code | (b) Diagnostics as the product | (c) Contribute upstream |
|---|---|---|---|
| Realistic gain on the bench | About 4 s per transition loop for the fixed wait (already gone wherever `ForceSyncSceneSwitch` is on), plus ~4 s for a high-risk terrain residency. Startup: 2–3 % | Indirect but largest. On the bench, acting on three findings (MM errors, drag cubes, ResearchBodies) is worth more than 120 s per startup [I] | `ForceSyncSceneSwitch` working with US2: 4–7 s per transition. `PQSOnlyStartOnce`: ~2 s per launch |
| Cost | High: residency infrastructure, per-mod validation, upkeep | Medium | Low to medium |
| Risk | High (terrain) to low (fixed wait) | Low: measuring only | Low; maintainers decide |

Chosen: **(b) together with (c)**. (a) is dropped.

## Consequences

- **Rename to T-Minus**, done on 2026-10-15. The repository is
  `AlexSkylark/ksp-tminus`. In the report:
  - startup is the **Countdown**;
  - each scene transition is a **Hold**.
- **The bench is pessimistic by construction.** Diagnostic results from it
  must say so:
  - MM always cold, so drag cubes are always regenerated;
  - the ResearchBodies cache is wiped by the save restore;
  - `ForceSyncSceneSwitch` is off.
- **Upstream candidates**, each to be decided separately:
  - the ChemicalPropulsion × Near Future Spacecraft patch fix;
  - ResearchBodies' per-pixel texture fill;
  - bench data for KSPCF #351 (does `PQSOnlyStartOnce` hold up with
    Kopernicus, Parallax and Scatterer?);
  - a narrower fix for KSPCF #273, so that `ForceSyncSceneSwitch` can stay
    on with US2.
- **Not measured, still open:**
  - about 8 s before `FlightDriver.Start`, and about 8 s of the flight entry
    frame, are not attributed;
  - the ProgressiveCBMaps flight-entry cost with a warm cache;
  - how all of this looks with a warm MM cache.

## Sources

- KSPCommunityFixes:
  - [#250](https://github.com/KSPModdingLibs/KSPCommunityFixes/pull/250)
  - [#271](https://github.com/KSPModdingLibs/KSPCommunityFixes/issues/271)
  - [#273](https://github.com/KSPModdingLibs/KSPCommunityFixes/issues/273)
  - [#275](https://github.com/KSPModdingLibs/KSPCommunityFixes/issues/275)
  - [#350](https://github.com/KSPModdingLibs/KSPCommunityFixes/pull/350)
  - [#351](https://github.com/KSPModdingLibs/KSPCommunityFixes/issues/351)
- [ResearchBodies #30](https://github.com/JPLRepo/ResearchBodies/issues/30)
  and [ProgressiveCBMaps source](https://github.com/JPLRepo/ResearchBodies/tree/master/ProgressiveCBMaps)
- [KSPModdingLibs/KSPProfiler](https://github.com/KSPModdingLibs/KSPProfiler)
- KSP 1.12.5 internals: the decompiled reference outside this repo, summarized
  by the `ksp-reference` subagent. No decompiled code is reproduced here.
