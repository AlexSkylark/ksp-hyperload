# Phase 1 findings: where the time goes on KSP-bench

Status: 2026-10-15. Input for Phase 2 planning.

This report answers Phase 1's question: where does startup and scene-transition
time go on a heavily modded install, and which part of it could HyperLoad
remove? Labels: **[C]** measured or read in code, **[I]** inferred.

Sources:
- the controlled series of 2026-10-15 (6 standard runs alternating profiler
  on/off, 1 diagnostic run, 1 GameEvent run);
- earlier runs from 2026-10-14.

Details, raw numbers and run archives are in
[benchmarks/results.md](benchmarks/results.md). The method is in
[benchmarks/protocol.md](benchmarks/protocol.md).

## The install and the conditions

- KSP 1.12.5 with 180 mods (`KSP-bench`).
- Machine: i5-12400, 48 GB RAM, RTX 4070, NVMe SSD.
- Conditions that hold in every run, and that make this bench **pessimistic**
  compared with a typical player install:
  - **ModuleManager is always cold.** Patch errors in one mod
    (ChemicalPropulsion) stop MM from saving its cache, so every startup
    re-applies 31,815 patches, and the cold path also deletes
    `PartDatabase.cfg`.
  - KSPCF 1.41.1 is installed, with FastLoader and its PNG texture cache
    warm.
- Transition runs use a sandbox save with Kerbal X launched from the VAB.
  KerbalConstructionTime is disabled for that save, see the protocol.
- Run-to-run spread:
  - Startup phases vary by about ±1 s between runs, and transitions by about
    ±0.2–1 s.
  - The first run after hours without KSP was about 13 s slower, entirely in
    the disk-bound phases (configs, assemblies, assets). [I] The OS file
    cache had partly gone cold. Startup numbers below use runs 2–6 for this
    reason.

## Startup: about 260–265 s to an interactive main menu

Means of runs 2–6. Sub-phase times come from KSPCF's `[KSPCF:FastLoader]`
report and KSP/MM log lines, which exist in every run. The phases come from
different sources, so they add up to ~265 s while the profiler measured
260–262 s in runs 3 and 5. Read them as a budget accurate to a few seconds.

| Phase | Time (s) | What it is | Source |
|---|---|---|---|
| Process start → first mod code | ~11.5 | Unity init, KSP's first full config parse (stock parser), assembly loading | [C] profiler anchor |
| GameDatabase | 51.5 | configs + assemblies 12.5, **second config parse 10.4** (7,289 `ConfigNode.Load`, 9.2 s), assets 21.9 (audio, textures, models via KSPCF FastLoader), bundles/rest ~1.2, frames ~5 | [C] |
| **Waiting for ModuleManager** | **64.7** | MM patches on a background thread while GameDatabase loads. This is the part that does not overlap | [C] `Waited ... for patching` |
| MM post-patch | 5.3 | apply patched configs, reload resources/traits/upgrades | [C] |
| **Part compilation** | **60.2** | 1,879 parts, 18,035 modules. `ParsePart` 38 s (includes icons, 6.2 s), `CompilePartInfo` 3.4 s, drag cube CPU work about 1 s; **~18 s not attributed** (frames yielded by the compile coroutine). The `ParsePart`/`CompilePartInfo` split comes from run 18:59 on 2026-10-14 | [C] / [I] for the rest |
| DLC, fonts, small mod loaders | ~1 | | [C] |
| Planetary system | 13.3 | Kopernicus: its `Injector` addon's `Awake` alone is 5.5 s | [C] |
| **Main menu, scene switch → interactive** | **57.8** | one blocking frame of ~50 s. **ProgressiveCBMaps `VisualMaps.Start()` = 41.2 s**; JanitorsCloset 1.2 s; Deferred 1.0 s; addons' `Awake` 1.5 s | [C] |

## Scene transitions

Profiler-on runs 1, 3 and 5. "Ready" means the player can act:
- main menu and tracking station: GUI ready;
- space center and flight: KSP's loading mask hidden;
- editor: `onEditorStarted`.

| Transition | Mean (s) | Range | Largest identified costs |
|---|---|---|---|
| Main menu → space center | 16.2 | 15.8–16.9 | scene-load frame ~4 s; Scatterer ~2.6–2.9 s; Kerbin ocean PQS init ~2.1 s; stock fixed wait ~2 s; FilterExtensions `Start` coroutine 2.3 s |
| Space center → VAB | 6.9 | 6.9–7.0 | not broken down |
| **VAB → flight** | **38.0** | 37.3–38.7 | see below |
| Flight → space center | 13.3 | 13.2–13.4 | Scatterer ~2.9 s; Kerbin ocean PQS ~2.1 s; save load ~1 s |
| Space center → tracking station | 4.1 | 4.1–4.2 | |
| Tracking station → space center | 2.8 | 2.7–2.9 | |
| Space center → main menu | 7.3 | 7.2–7.4 | |

**VAB → flight (38 s).** KSP's own log lines inside `FlightDriver.Start`
split it as follows [C], identically in all 6 runs:

| Part | Time (s) |
|---|---|
| Editor unload + scene load, until `FlightDriver.Start` | 8.4 |
| Save load | 0.3 |
| Ship construction (parts, modules) | 0.45 |
| Launch-site terrain build (Kerbin PQS) | 1.9 |
| Vessel creation, crew, IVA | 0.1 |
| Reset of every planet's terrain (`SetPQSActive()`) | 2.45 |
| After `FlightDriver.Start`, until the UI shows | ~24 |

Of the last ~24 s, log-gap analysis attributes **~14–15 s to
ProgressiveCBMaps**: one `setVisualLevel` per celestial body, about 30
bodies at 0.5–2.8 s each. About 4 s goes to terrain init and about 2.9 s to
Scatterer.

The vessel itself is cheap here: all part and module work stays under 1 s
for a ~20-part craft.

## What is spent on what

| Bucket | Startup (s) | Main transitions (s) | Owner |
|---|---|---|---|
| ModuleManager cold patching (wait) | ~65 | — | MM, made worse by one mod's patch errors |
| Part compilation | ~60 | — | KSP PartLoader (KSPCF already optimizes parsing/icons) |
| Config parsing (two full passes) | ~23 | — | KSP (first pass) / KSPCF ConfigNodePerf (second) |
| Asset loading | ~22 | — | KSPCF FastLoader |
| **ProgressiveCBMaps** | **~41** | **~15 per flight entry** | one mod |
| Planet system / terrain | ~13 | ~4–6 per transition | Kopernicus, stock PQS |
| Visual mods at scene load (Scatterer, ...) | — | ~3 per transition | mods |
| Unity scene unload/load | — | ~4–8 per transition | engine |

## Implications for HyperLoad (Phase 2 onward)

These are recommendations to discuss, not decisions.

1. **The two largest single costs are not HyperLoad's to fix.**
   - **MM cold patching (~65 s):** on a normal install with a valid MM cache
     it mostly disappears. Our bench can't show the warm case.
   - **ProgressiveCBMaps (~41 s + ~15 s):** internal to one mod.
     **Recommendation:** report it upstream with this data, and add a warm-MM
     reference install, or document the warm case separately, so Phase 2
     results are not judged only on the pessimistic bench.
2. **Part compilation (~60 s) is the largest cost KSP itself owns, every
   startup.**
   - KSPCF already covers icons and field parsing.
   - About 18 s are not attributed: [I] frames yielded by the coroutine.
     Measuring that is the cheapest next profiler step, with no extra bench
     runs needed beyond the next regular one.
   - Caching compiled parts across sessions would be a Level 2+ change
     (Unity objects), not a Phase 2 cache.
3. **Config parsing (~23 s, two full passes)** is a Level 0 cache candidate,
   because the inputs (GameData files) are hashable.
   - The first pass runs before any mod code, so it can't be touched.
   - The second pass runs inside KSPCF's FastLoader, so any work there must
     coexist with KSPCF. Check KSPCF's roadmap first.
4. **Transitions repeat the same work every time:**
   - planet terrain reset: ~2.5 s per flight entry; KSPCF `PQSOnlyStartOnce`
     exists but is off by default because of a known issue;
   - Scatterer/visual re-setup: ~3 s;
   - scene unload/load: ~4–8 s;
   - per-scene mod work, about 15 s per flight entry for ProgressiveCBMaps.

   This is what the proposal's residency phases (3–5) target. **Space
   center ↔ flight (13–38 s) is the transition worth optimizing first.**
5. **The profiler is good enough to drive these decisions.**
   - Transition overhead is not measurable (±0.1 s).
   - Startup overhead is about 1–3 %, likely nearer 1 % once run 1's cold
     file cache is excluded. It was not investigated further. It is a known
     limitation, smaller than the run-to-run spread for any single phase.

## Open questions

- What fills the ~18 s of part compilation outside `ParsePart` and
  `CompilePartInfo`?
- What fills the remaining ~8 s of the flight-entry frame, and the 8.4 s
  before `FlightDriver.Start`?
- Which mechanism ProgressiveCBMaps uses in flight. [C] Not a GameEvent, and
  not an addon `Start`. Not needed for HyperLoad decisions.
- How these numbers change with a warm MM cache.
