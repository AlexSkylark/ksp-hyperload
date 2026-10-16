# M5 re-plan: profiler first (draft)

Status: **approved** (2026-10-15). Replaces steps 2–7 of the first M5 plan.

## Why

M5 as first planned spent two steps (log-only breakdown, per-mod findings
from log gaps) reconstructing by heuristics what the profiler measures or
could measure. Since summary format 2 the profiler writes its numbers into
`KSP.log` itself, so a player who installs T-Minus and posts the usual log
gives the analyzer measured data. Log-only analysis stays, as a minimal
fallback. The work goes to measuring the blind spots instead.

Kept from the first plan: the base parts of step 2 that both levels need,
the MM and KSPCF log findings (the log is their only source), findings from
profiler data. Reversed: `mechanisms.md` "Dropped: per-call cost of Harmony
patches" (never measured, so no case could appear).

## Research (ksp-reference, 2026-10-15)

Tags: `[C]` read in code, `[I]` inferred. Paths in the decompiled
Assembly-CSharp, Harmony 2.2.1.0 and KSPCF 1.41.1.

### Module dispatch (stock, non-virtual, no KSPCF conflict)

| Hook | Times | Attribution | Volume |
|---|---|---|---|
| `PartModule.Load(ConfigNode)` | field load, upgrades, then virtual `OnLoad` `[C]` | `__instance.GetType()` | once per module at part compile, and per module of every part loaded in Holds. KSPCF `ModuleIndexingMismatch` replacements still call it `[C]` |
| `PartModule.Awake()` | reflection setup, then `OnAwake` `[C]` | type | per module per instantiation; `Part.AddModule(forceAwake)` can call it twice at compile `[C]`; a mod type declaring its own `Awake` bypasses it `[I]` |
| `VesselModule.Awake/Start/Load` | `OnAwake`, `OnStart`, `OnLoad` `[C]` | type | per vessel × VesselModule types; tiny bodies, Harmony marks them NoInlining `[C]` |
| `Part.ModulesOnStart`, `ModulesOnStartFinished`, `InitializeModules` | per part: every module's `OnStart`, `OnStartFinished`, `OnInitialize` `[C]` | part; per module only via markers (below) | per part. KSPCF prefix/postfix on `ModulesOnStartFinished` (cheap) `[C]` |
| `ProtoPartSnapshot.Load(Vessel,bool)` | one saved part: instantiate + every module Awake/Load `[C]` | part | per part of each loaded vessel |
| `ProtoVessel.Load(FlightState,Vessel)`, `Vessel.Load()` | vessel object + VesselModules; parts + `OnLoadVessel` `[C]` | vessel | per vessel |
| `ShipConstruct.LoadShip`, `ShipConstruction.AssembleForLaunch` | launch / craft load `[C]` | ship | per launch |

Already hooked: `ScenarioRunner.AddModule` (scenario modules), addons per
scene (`StartAddons`/`StartAddon`), `ConfigNode.Load`, GameEvents per event,
PartLoader methods, PQS, `Game.Load`.

Per module `OnStart` has no stock funnel `[C]`. Markers: in
`ModulesOnStart` each iteration begins with
`ModuleResourceHandler.SetPartModule(module)`, then the virtual
`PartModule.ApplyUpgrades(StartState)` (the marker: see step 3); in `ModulesOnStartFinished` `PartModule.ApplyAdjustersOnStart()`
follows each `OnStartFinished` `[C]`. The alternative, a call-site
transpiler on stock loops, is rejected for now (it rewrites stock code).

Unity messages (a mod's own `Start`, `OnEnable`, coroutines) have no stock
dispatch point `[C]`. Measure them as the **residual**: long-frame time in a
Hold minus the timed spans inside it. The lazy `AddonStartHooks` pattern
(opt-in) could extend to module types first seen by the hooks above.

### Assets per file

With KSPCF FastLoader no stock per-file method runs for stock formats; they
go through KSPCF's private `KSPCFFastLoader.RawAsset` code `[C]`. Patching
that is patching a mod: rejected. Without patching: an
`Application.logMessageReceived` listener stamps each `Load(...)`/`Load
{type}: {url}` line with the profiler clock; FastLoader logs right before
decoding each file `[C]`, so consecutive stamps give main-thread per-file
spans with a URL under both stock and FastLoader. Audio loads 25 files in
flight: not separable. The profiler has no log listener today.

### Harmony: cost of applying patches

- Single choke point: internal `HarmonyLib.PatchFunctions.UpdateWrapper
  (MethodBase, PatchInfo)`. Every `Patch`, `PatchAll` (via
  `PatchClassProcessor.ProcessPatchJob`, which bypasses
  `PatchProcessor.Patch`) and every unpatch goes through it; it never nests
  `[C]`. Reverse patches take another path (`PatchFunctions.ReversePatch`).
- Not covered by it: patch-list (de)serialization and `PatchAll`
  reflection in the callers. Optional exclusive timing on
  `PatchProcessor.Patch`/`Unpatch` and `PatchClassProcessor.Patch` `[I]`.
- Owner: not passed in. Keep a shadow map `MethodBase → patch methods`,
  seeded from `GetAllPatchedMethods`; new entries give owner id, kind,
  priority and `PatchMethod.DeclaringType.Assembly` `[I]`. Do not key on
  `Patch.index` (repeats after unpatch) `[C]`.
- Self-patching: our patch on `UpdateWrapper` runs under
  `PatchProcessor.locker`; locks are re-entrant; the hook must never call
  patching APIs `[C]/[I]`. To verify in game.
- Order: KSPCF has no preloader; its first patches come from Instantly
  addons after ours (positions 73–77 vs our ~5 on the bench). Addons created
  before us were not checked: snapshot the patched methods at install and
  log `N methods already patched before T-Minus`.

### Harmony: per-call cost of mod patches (opt-in)

- Sorting: higher priority first, ties by add order; priorities are plain
  ints, not clamped. Use `int.MaxValue`/`int.MinValue` `[C]`.
- Emitted order: prefixes, body (transpilers included, not separable),
  void postfixes, pass-through postfixes, finalizers `[C]`.
- Inner bracket: prefix at `int.MinValue`, void postfix at `int.MaxValue`.
  Outer bracket: prefix at `int.MaxValue`, **void finalizer** at
  `int.MinValue` (postfixes do not run on exceptions; pass-through postfixes
  run after void ones) `[C]`. Adding the first finalizer wraps the method in
  try/catch; Harmony rethrows `[C]`.
- A void prefix whose only parameter is `__state` still runs when an
  earlier prefix skips the original `[C]`. `__runOriginal` is unreliable in
  2.2.1 `[C]`.
- Mods patching later keep our patches, re-sorted; each later patch is one
  rebuild that includes ours `[C]`. `UnpatchAll(null)` removes ours too.
- Identify the method cheaply: a precompiled pool of non-generic stub
  classes, one per bracketed method, handed out by a patch factory (cached:
  it is called on every rebuild). No `__originalMethod` lookup per call;
  `__state` works (it does not in DynamicMethods) `[C]/[I]`.
- Bracket only methods already patched by others (from the inventory):
  bracketing changes a method's compilation (DynamicMethod, NoInlining)
  `[C]`. Methods without a body and inherited members cannot be patched.

## Proposed steps (one commit each)

1. Done: profiler fixes, summary format 2.
2. **Analyzer base (slim)**: `,`/`.` numbers; mod from URL and from
   assembly (one attribution helper: type → assembly → mod folder, shared by
   profiler data and the log). Done 2026-10-16; addon batch ends and the
   gap helper moved to step 8, only if the fallback needs them.
3. **Profiler: module dispatch.** Aggregates by type for `PartModule.Load`/
   `Awake`, `VesselModule.Awake/Start/Load`; per part `ProtoPartSnapshot.Load`
   and `ModulesOnStart`/`ModulesOnStartFinished`/`InitializeModules` (per
   module via markers); per vessel `ProtoVessel.Load`, `Vessel.Load`; Hold
   residual. Nested levels kept separate (self time in the analyzer).
4. **Profiler: Harmony.** `UpdateWrapper` timing per owner/assembly
   (default on); pre-install snapshot; per-call brackets on patched stock
   methods (opt-in setting).
5. **Profiler: assets per file** from log line stamps (no patching).
6. **Findings from profiler data**: the first plan's step 6 plus expensive
   module types per mod, Harmony patching per mod, patch overhead per
   method, assets per mod folder, unattributed Hold residual. Summary
   format 3 carries what the findings need.
7. **MM and KSPCF log findings** (the first plan's step 5).
8. **Log-only fallback**: coarse Countdown/Hold phases and "install T-Minus
   to see which mod".
9. Thresholds review, design catalog, overhead series on KSP-bench, status.

Validation: steps 3–5 on KSP-dev and KSP-scenario (with a real mod copied
from the bench, see Decisions). Volumes and overhead on KSP-bench.

## Decisions (Alex, 2026-10-15)

- Per-module `OnStart` via **markers**; no call-site transpiler.
- Per-call Harmony brackets are **opt-in**.
- No test mod of our own: copy a real mod from KSP-bench into KSP-scenario
  (copying reads the bench, never changes it). Candidate:
  **RocketSoundEnhancement 0.9.13.0** (`RocketSoundEnhancement`, 300 KB,
  plus its config pack `RocketSoundEnhancementDefault`, 109 MB): PartModules
  (`RSE_Engines`, `RSE_Coupler`, ...) added to stock parts by MM, a
  VesselModule, Harmony patches; needs only Harmony and MM, both on the
  scenario. Per-call brackets can also be checked on KSPCF's own patches
  on stock per-part methods (e.g. `Part.ModulesOnStartFinished`). A real
  mod has no known expected value: validation checks attribution, the
  magnitude against the log, and consistency across runs. The mod goes in
  at step 3, recorded as a scenario case with its run.

## Step 3: module dispatch (2026-10-16)

Hook group `moduleHooks` (on by default). Families in the `.jsonl`, all
aggregates written at checkpoints; levels nest and are inclusive:

| Family | Key | Source |
|---|---|---|
| `module.load`, `module.awake` | `<assembly>/<type>` | `PartModule.Load(ConfigNode)`, `PartModule.Awake()` |
| `module.onStart`, `module.onStartFinished` | `<assembly>/<type>` | markers in `Part.ModulesOnStart` / `ModulesOnStartFinished` |
| `vesselModule.awake`, `.start`, `.load` | `<assembly>/<type>` | `VesselModule.Awake/Start/Load` |
| `part.load`, `part.modulesOnStart`, `part.modulesOnStartFinished`, `part.initializeModules` | part name | `ProtoPartSnapshot.Load`, the three `Part` loops (top 50) |
| `vessel.protoLoad`, `vessel.load` | vessel type | `ProtoVessel.Load(FlightState,Vessel)`, `Vessel.Load()`; `vessel.load.slow` span (≥ 100 ms) with the part count |

Hold residual: every `frame.long` span carries `covered` (ms inside timed
hooks of the enabled groups, nesting merged; coroutine spans excluded,
`Profiler/FrameCoverage.cs`). The report prints covered and outside time
per long frame. Summary format unchanged: format 3 comes with the findings
(step 6). Not hooked: `ShipConstruct.LoadShip`,
`ShipConstruction.AssembleForLaunch` (add if editor/launch Holds show
uncovered time there).

Marker: `ApplyUpgrades`, not `SetPartModule`. The first validation runs
had no `module.onStart` record: `SetPartModule` is a one-line setter, Mono
inlines it into `ModulesOnStart`, and a Harmony patch on an inlined method
never runs. Virtual calls are not inlined. Rule for every hook: never
patch a small non-virtual method (a setter, a one-line getter) and expect
it to fire.

Marker limits: a module that overrides `ApplyUpgrades` without calling
base gives its time to the previous module (none in stock or the
reference mods); a module whose `OnStartFinished` throws gives its time to
the next module; a module added during `ModulesOnStart` is not timed
separately (its time stays with the module that added it).

Scenario case `rse` (2026-10-16): RocketSoundEnhancement 0.9.13.0 and
RocketSoundEnhancementDefault copied unchanged from KSP-bench into
KSP-scenario (`diff -r` identical). Purpose: real mod PartModules added by
MM to stock parts, a VesselModule, Harmony patches.

Validation (2026-10-16): `D:\KSP\dev-runs\20261016-024719` and
`D:\KSP\scenario-runs\20261016-024946`, usual route, build of 9ca2f47.
- 31 hooks applied, 0 unavailable, 1 disabled; no `[TMinus]` errors (the
  scenario's 5 "fx group" errors come from RSE content: the bench log has
  them too).
- `module.load`/`module.awake` keyed by stock types on dev (102/120 keys)
  and RSE types on scenario: `ShipEffectsCollisions` `Load` 489 ms over
  546 calls, the largest module entry. `vesselModule.*`, `vessel.protoLoad`,
  `part.*` and `module.onStartFinished` present on both.
- `covered` on every `frame.long` (16 dev, 12 scenario), never above the
  frame. Hold frames 11–75 % covered; Countdown asset frames ~0 % (no hooks
  there, expected).
- Startup (Loading Systems): dev 48.9 s (earlier dev runs 45.4–55.6),
  scenario 26.4 s (27.3, 27.7): within noise.
- Failed: no `module.onStart` record (the `SetPartModule` inlining above).
  Fixed with the `ApplyUpgrades` marker; **to re-check** in one scenario
  run: `module.onStart` keys present, their sum close to
  `part.modulesOnStart` (97 ms on the scenario run).
- `check-archived` gained `when.mod` (GameData folder present, or absent
  with `!`), so scenario checks follow its cases; the suite now has case
  `rse` checks (`expensive-addon` for `RocketSoundEnhancement.Startup`).
