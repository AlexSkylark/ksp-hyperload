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
  try/catch; Harmony rethrows `[C]`. (Step 4b uses a void postfix
  instead: see "Step 4b".)
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
5. Done: **assets per file**, in the analyzer from KSP.log's own stamps
   (see "Step 5"; first planned as a profiler log listener).
6. **Findings from profiler data**, split in three (Alex, 2026-10-16):
   - 6a. Done: findings from data that already exists (see "Step 6a").
   - 6b. Profiler: summary format 3 (module types per mod, Harmony
     patching per owner, the top per-call overheads, the assembly in the
     `scenario.load` key), and the deferred unbracket item from step 4b.
     Validated with `Invoke-Run.ps1` on KSP-dev and KSP-scenario.
   - 6c. New rules: `expensive-part-modules` per mod (stock left out),
     `harmony-patching-cost` per owner mod (T-Minus left out, neutral
     action), `patch-call-overhead` per method (owners from the
     inventory), `unattributed-hold-time` (informational, no mod blamed).
   - Out of scope: terrain start (`pqs.forceStart`, stock) and memory,
     shown as context only. Thresholds: 1 s per mod or module, 2 s for the
     residual, provisional until step 9.
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
  Fixed with the `ApplyUpgrades` marker (e92a838) and re-checked on
  `D:KSPscenario-runs61016-030002`: `module.onStart` 43 keys,
  96.1 ms over 714 calls (one per module, as `onStartFinished`) against
  `part.modulesOnStart` 97.4 ms; top entry `RSE_Engines` 24.5 ms.
- `check-archived` gained `when.mod` (GameData folder present, or absent
  with `!`), so scenario checks follow its cases; the suite now has case
  `rse` checks (`expensive-addon` for `RocketSoundEnhancement.Startup`).

## Step 4a: Harmony patching cost (2026-10-16)

Split from step 4 (Alex, 2026-10-16): 4a times patching, 4b (per-call
brackets, opt-in) gets its own design and commit after 4a is validated.

Hook group `harmonyHooks` (on by default), `Hooks/HarmonyHooks.cs`, applied
first so every later patch is timed, T-Minus' own included. Prefix and void
finalizer on internal `HarmonyLib.PatchFunctions.UpdateWrapper(MethodBase,
PatchInfo)`; the finalizer also times failed rebuilds (Harmony rethrows).

| Record | Key | Meaning |
|---|---|---|
| `harmony.patch`, `harmony.unpatch` | `<assembly of the patch methods>/<Harmony id>` | rebuilds the owner caused (count) and their time |
| `harmony.target` | `<assembly>/<type>.<method>` (top 50) | rebuilds of each patched method, any owner |
| `harmony.before` counter | owners in detail | methods already patched when the hook was applied (not timed) |
| `harmony.patch.failed` mark | key: method | a rebuild that threw |

Owner: Harmony stores a method's patches only after `UpdateWrapper`
returns (`PatchProcessor.Patch`, `PatchClassProcessor.ProcessPatchJob`,
unpatch alike) `[C]`, so the finalizer compares per-owner patch counts in
`patchInfo` with the stored list (or the hook's last view of the method):
owners that gained patches paid; with none, an owner that lost them (an
unpatch). Never `Patch.PatchMethod` on stored patches: Harmony 2.2.1
serializes patch info, and the getter on a deserialized patch scans every
loaded module `[C]`. Only the clock is read before the original runs.

Not timed: patch info (de)serialization and `PatchAll`'s reflection,
outside `UpdateWrapper`. Reverse patches take another path.

Validation (2026-10-16): `D:\KSP\dev-runs\20261016-031016` and
`D:\KSP\scenario-runs\20261016-031254`, usual route, build of c693222.
- 32 hooks applied, 0 unavailable; no `[TMinus]` errors, no patch errors
  from other mods (scenario: the same RSE "fx group" errors and KSPCF's
  intended loader exception as before).
- `harmony.before` 0 on both: nothing patched before the hook.
- Dev: only `TMinus/TMinus.Profiler`, 119 rebuilds, 666 ms.
- Scenario: KSPCF 373 rebuilds, 1176 ms under its main id plus its
  per-feature ids (`KSPCFFastLoaderAssetAndPartLoader` 39 ms, `ConfigNodePerf`
  32 ms, ...; KSPCF logs 126 "Patch ... applied" lines, several methods
  each); T-Minus 120 rebuilds, 684 ms; RSE 1 rebuild, 0.4 ms (its assembly
  has a single `Postfix`). Unpatches: KSPCF's FastLoader removes its loader
  patches, 10 rebuilds, 32 ms. Largest single rebuild 37 ms
  (`ShipConstruct.LoadShip`).
- Startup (Loading Systems): dev 47.3 s, scenario 26.0 s: within noise.
- Not cross-checked against the `patches` inventory: copying `000_TMinus`
  from KSP-dev replaced the scenario's `Settings.cfg` (`patchInventory` back
  to false). Restored; the next scenario run (4b) has the inventory.

Deferred to step 9 (overhead): T-Minus' own patching is ~0.7 s of startup
(119 rebuilds, ~1.4 % of KSP-dev's Countdown), most of the profiler's
known ~1 % overhead. Measured now; whether to apply fewer hooks or apply
some lazily is a step 9 decision.

## Step 4b: per-call cost of other mods' patches (2026-10-16)

Design agreed with Alex 2026-10-16. Hook group `harmonyCallHooks`, **off by
default** (diagnostic: it rebuilds patched methods once more and adds a
small cost to every call), requires `harmonyHooks`.
`Hooks/HarmonyCallHooks.cs`, stubs in `Hooks/HarmonyCallSlots.g.cs`
(generated by `tools/codegen/harmony-call-slots.mjs`, 1024 slots plus the
calibration slot; regenerate to change the size).

Brackets around all of a method's patches, under their own Harmony id
`TMinus.Profiler.Calls` (so 4a shows their rebuilds separately):

```
outer prefix (int.MaxValue), mods' prefixes, inner prefix (int.MinValue),
  body (transpilers included),
inner postfix (int.MaxValue), mods' void postfixes, outer postfix (int.MinValue)
```

Decisions, against the research above:
- **Outer end is a void postfix, not a finalizer.** A finalizer makes
  Harmony wrap the method in try/catch (rethrow keeps the stack trace, but
  the method's structure changes: design rule 1). Cost: calls that throw are
  not counted, and other mods' finalizers and pass-through postfixes run
  after the outer postfix: such methods are reported as partial.
- **One slot of generated stub classes per method** (an Outer and an Inner
  class: `__state` is one local per patch class `[C]`). A call reads the
  clock and adds to per-slot counters with `Interlocked`; no
  `__originalMethod` (`ldtoken` + `GetMethodFromHandle` per call `[C]`,
  inside the outer window). DynamicMethods and generic patch classes cannot
  be patch methods (resolved by token after serialization `[C]`).
- **Two rebuilds per method** (`PatchProcessor` takes one prefix and one
  postfix per call `[C]`): inner pair first, so calls in between only add
  body time.
- **Which methods:** those with a prefix, postfix or finalizer from another
  owner (found by 4a's finalizer, or already patched when the group is
  applied). Skipped, with the reason counted: `own` (a T-Minus timing hook
  patches it: its Priority.First prefix would fall inside the outer
  window), `transpiler-only`, `static-constructor`, `generic`, `pool-full`.
  A bracketed method that T-Minus patches later, or whose bracketing fails,
  is excluded from the records.
- **When:** never inside `UpdateWrapper` (Harmony's lock). Queued, then
  bracketed from `ProfilerHost.Update`, 10 ms of work per frame.
- **Calibration:** at apply time, an empty NoInlining T-Minus method is
  bracketed and called 3 × 20000 times; the minimum per call of each window
  is recorded. Records are raw; subtracting calibration × calls is the
  analyzer's (inferred) job.
- `__runOriginal` is unreliable in 2.2.1 (research above): skipped originals
  are not counted; their body time is ~0 and the skipping prefix counts as
  patch time, which is right.

| Record | Key | Meaning |
|---|---|---|
| `harmony.call.patches` aggregate | `<type>.<method>` (top 100 by time, rest in "(other)") | calls since the last checkpoint, and outer − inner time: what others' patches add. Max not tracked (0) |
| `harmony.call.body` aggregate | same | inner time: the body, transpilers included; inclusive under recursion |
| `harmony.call.calibration.patches`, `.body` counters | | brackets' own cost per call, ns |
| `harmony.call.bracketed` counter | | methods bracketed and counting |
| `harmony.call.skipped` counter | `reason=n,...` | not bracketed or excluded |
| `harmony.call.partial` counter | method keys | other finalizers or pass-through postfixes outside the window |
| `harmony.call.bracket` mark | `<method>: <owners>` | when a method was bracketed, and who patches it |
| `harmony.call.failed` mark | `<method>: <error>` | bracketing failed (our patches removed) |

The overhead cannot be split per owner: the bracket mark lists the owners.

Validation to run: KSP-scenario (`patchInventory` and `harmonyCallHooks`
on) and KSP-dev (`harmonyCallHooks` on: expect 0 bracketed), usual route.
Check: no `[TMinus]` errors or `harmony.call.failed`; calibration stable
across runs; KSPCF's and RSE's methods bracketed, with plausible calls and
times; bracketed + skipped matches the inventory's methods with other
owners; the brackets' rebuilds under `TMinus/TMinus.Profiler.Calls` in
`harmony.patch`.

**Validated 2026-10-16** (fec8380, first automated runs:
`tools/run/Invoke-Run.ps1`) on `dev-runs/20261016-081609` and
`scenario-runs/20261016-081853`. Both routes finished and both runs passed
`check-archived`.
- **KSP-dev:** 0 bracketed, 0 skipped.
- **KSP-scenario:** 199 bracketed, 181 skipped (`own=11`,
  `transpiler-only=170`), 0 partial, no `harmony.call.failed`, no `[TMinus]`
  errors.
- **Methods compared with the inventory.** Bracketed + skipped = 380, and
  the inventory at the main menu lists 372 methods with other owners. The
  difference of 8 is the KSPCF FastLoader patches: they were bracketed or
  skipped while patched, and FastLoader removed them (10 unpatches) before
  the inventory was taken. Repeated keys are overloads.
- **Calibration:** 50.0 / 24.0 ns per call (patches / body) on scenario and
  50.3 / 23.9 on dev, so stable.
- **Rebuilds:** 400 under `TMinus/TMinus.Profiler.Calls`, 1.17 s in total
  spread over frames, 60.6 ms the longest.
- **Top patch time is plausible:**
  - `PQS.BuildTangents` 27.5 ms over 1875 calls;
  - `Part.FindModelTransform` 16.3 ms over 7408 calls;
  - `Part.UpdateMouseOver` 7.9 ms patches against 7.2 ms body over 123k calls.
  - KSPCF's prefix-replaced methods show a body of about 0, as expected.
  - RSE's `AudioSource..ctor` is bracketed.

Deferred (small, behavior unchanged):
- **Brackets on methods that lose their last other-owner patch.** Example:
  FastLoader's methods after its unpatch. They keep T-Minus's brackets and
  report patch time near 0. `Observe` sees the rebuild, but returns early
  because no other owner is left.
- **Possible fix.** Queue an unbracket for `ApplyPending`, then mark the
  method `excluded-unpatched`. Do it with step 6, if the findings use these
  numbers.

## Step 5: assets per file (2026-10-16)

**Decision (Alex, 2026-10-16): analyzer only, no profiler change.** The
plan had a profiler log listener that stamps each per-file `Load` line.
KSP.log already stamps those lines to the millisecond, and the sum of
the log gaps matches FastLoader's own report:
- scenario: 4.8 s, plus 0.6 s of audio, against 5.45 s reported;
- bench: 18.3 s, plus 10.3 s of audio, against 28.8 s reported.

The listener would give the same numbers to fewer players: only those
with T-Minus installed.

What was built: `tools/analyze/src/core/assets.ts`, a "Assets per file"
section in the report's Countdown, and `src/test/assets.test.ts`.
- **Lines read** `[C]`:
  - stock `Load(Texture|Model|Audio): <url>` (optional ` OUT OF DATE`);
  - FastLoader `Load <TypeName>: <url>`, and
    `Load Texture|Model|Audio: <url>` for files it hands to other mods'
    loaders (`FastLoader.cs`).
  - The Countdown only: a database reload after the main menu is not
    startup.
- **A file's time** runs from its line to the next asset line, or to the
  first other `LOG`-level line (the phase's end, "Loading Asset Bundle
  Definitions" on both forms). Warnings and errors in between belong to
  the file. Inferred, not measured: a frame boundary inside a file counts
  toward it.
- **Audio under FastLoader** loads up to 25 clips at a time. Its time is
  shown as one number and left out of the per-folder and per-format
  tables.
- **Groups:** by GameData folder (`folderOfUrl`), by format, slowest
  files; FastLoader's report as a cross-check when present.

Validated on the archive, no new game run (no game code changed):
- `dev-runs/20261016-081609` (stock): 2370 files, 15.7 s; the slowest are
  `_NRM` textures (stock converts normal maps at load), up to 1.0 s each.
- `scenario-runs/20261016-081853` (FastLoader): numbers above.
- `bench-runs/20261015-031604` (FastLoader, 180 mods): 10081 files, ReStock
  first with 1.8 s.
- 48 unit tests pass; all 24 archived runs pass `check-archived`.

For step 6: the finding "assets per mod folder" reads `AssetLoads`. No
threshold yet: that goes to step 9.

## Step 6a: findings from existing data (2026-10-16)

Analyzer only; no game code changed, so no new run. Shared helpers for a
profiler aggregate's place (Countdown, Hold, between Holds, from the
checkpoint that wrote it) moved to `core/findings/places.ts`
(`expensive-addon` uses them too).

- **`expensive-scenario-module`** (profiler, new). `scenario.load`
  aggregates (`ScenarioRunner.AddModule`: `ProtoScenarioModule.Load`
  and the module's `OnLoad`) summed per module over the session, ≥ 1 s,
  cost by Hold. The record names the module, not its assembly, so the mod
  is guessed by name (`modOfSource`) and the finding says so; 6b adds
  the assembly. Nothing on the archive reaches 1 s (bench
  `031604`: UnloadedResources 0.9 s).
- **`buffered-scene-switch`: measured cost** with profiler data (the
  .jsonl or summary format 2). Profiler transitions are paired in order
  with the `Scene Change` lines of the same switch; each buffered Hold
  counts its `scene.bufferedLoad.step` time plus
  `scene.overlayAfterGuiReady` for targets SPACECENTER and EDITOR only,
  the ones whose overlay a direct switch hides at scene load (mechanisms
  6.2; flight waits for its vessel either way). A lower bound: the
  cleanups inside the async load are not timed apart. KSPCF PR #250's
  4–7 s stays as a note. Without the profiler the cost stays
  "not measured". Every local run is buffered (stock dev, and the
  scenario case), so there is no sync control run; the overlay's
  attribution rests on the code reading in 6.2. Results:
  - scenario `081853`: 4.9 s (FLIGHT->SPACECENTER 2.4, MAINMENU->SPACECENTER
    2.3, the rest 0.1 each);
  - bench (builds older than summary format 2, no overlay record): 2.1 s of
    steps only; the evidence says "not recorded".
- **`drag-cubes-regenerated`: measured cost** from the profiler's
  `SetupDragCubeCoroutine(...) span` aggregates in the Countdown (the
  .jsonl only), else the log estimate. The title keeps the log's count of
  generated parts; a note explains a higher profiler count (parts that
  went through the same code and found their cubes in the database).
  Scenario: 5.4 s measured, 421 timed against 412 generated. Closes the
  deferred item from step 1.
- **`asset-loading-by-mod`** (log, new, informational). Step 5's
  `byFolder` for mod folders (`isModFolder` in `core/mods.ts`: not stock,
  not T-Minus), ≥ 1 s, cost estimated (upper bound), confidence heuristic.
  Evidence: the folder's slowest files; notes: its formats, and FastLoader
  PNG/JPG time when ≥ 0.5 s (decoded and compressed on the main thread;
  stock lines do not name the format). On the bench, ReStock,
  KerbinSide(Remastered) and StationPartsExpansionRedux sit around 1.0–1.8 s,
  so which ones show changes from run to run: the threshold is for step 9.

Tests: 54 unit tests pass. `check-archived`: all 24 runs pass; the
KSP-scenario suite gained two checks (the buffered case measured ≥ 4 s
with MAINMENU->SPACECENTER among its places, at both profiler levels; no
ScenarioModule or asset findings), and the ≥ 4 s check was seen to fail at
40 s.
