# Mechanism survey

Status: **in progress** (roadmap milestone M4), started 2026-10-15.

Where KSP 1 spends loading and scene-switch time, what controls it, and what
evidence each mechanism leaves in `KSP.log` or the T-Minus profiler. Every
analyzer rule comes from a mechanism described here (design principle 6).
The archived runs only confirm that the evidence looks the way the code
predicts. No rule, threshold or action is tuned to them.

## How to read this document

Sources:

| Source | Version | Location |
|---|---|---|
| KSP | 1.12.5 | Decompiled `Assembly-CSharp` (outside the repo, see CLAUDE.md) |
| ModuleManager | 4.2.3 (tag `v4.2.3`) | `E:\Projetos\ksp-reference\mods\ModuleManager`; paths below are relative to it |
| KSPCommunityFixes | 1.41.1 | `E:\Projetos\ksp-reference\mods\KSPCommunityFixes` |
| Harmony | 2.2.1.0 | `E:\Projetos\ksp-reference\mods\Harmony` |

- **No code here.** The document names classes and methods and describes
  what they do. ModuleManager is CC BY-SA: its behavior is described, never
  copied. Log messages are quoted exactly, because rules match them.
- **Confidence of each claim:**
  - `[C]`: read in the code;
  - `[I]`: inferred;
  - `[R]`: confirmed in an archived run.
- **In log formats:** `{x}` is a placeholder, and `{F3}` is a number with
  three decimals.

Each mechanism has six parts:
- **What happens:** classes and methods, in order.
- **What controls it:** mods, settings, files.
- **Evidence:** the exact log line, who writes it and since which version;
  or the profiler record.
- **Robustness:** what changes between versions of KSP, ModuleManager,
  KSPCF and mods, and how a rule fails closed: it reports less and never
  guesses.
- **Coverage:** an existing rule (M3), a candidate rule for M5, or not
  detectable.
- **Player action:** what the player can do. T-Minus never changes the game.

Each area ends with its candidate rules for M5 and the analyzer issues it
found.

Areas:
1. [ModuleManager](#1-modulemanager)
2. [KSPCommunityFixes across versions](#2-kspcommunityfixes-across-versions)
3. PartLoader (to do)
4. GameDatabase (to do)
5. Assemblies and addons (to do)
6. Scene switches (Holds) (to do)
7. Harmony (to do)
8. Mono and Unity memory (to do)

---

## 1. ModuleManager

ModuleManager (MM) rewrites the game's config nodes with patches from every
mod (`@PART[...]`, `:NEEDS[...]`, `:FOR[...]` and so on) before parts are
compiled. It is on almost every modded install, and patching from scratch is
often the largest single cost of a heavy install's startup. MM can skip
patching on later startups by saving the patched result in a cache.

### Writers and log sinks

MM writes through three channels. Rules must know which one a line comes
from `[C]`:

- **Direct to KSP.log.**
  - Writers: the `[ModuleManager]` prefix logger (`PrefixLogger` over
    Unity's logger) and `ModuleManager.Log`.
  - Lines have KSP's usual form, `[LOG hh:mm:ss.fff] [ModuleManager] ...`.
  - They are written on the main thread, where KSP sets the culture to `en`
    (`HighLogic`, `Thread.CurrentThread.CurrentCulture`), so numbers use a
    `.`.
- **`Logs/ModuleManager/ModuleManager.log`.**
  - Written by `MMPatchLoader` on a worker thread, through a queue drained
    by a logging thread.
  - Lines look like `[LOG hh:mm:ss.fff] message`, with **no**
    `[ModuleManager]` prefix. The time is `DateTime.Now` when the line was
    queued.
  - The level tags are `LOG`, `WRN`, `ERR`, `EXC`, and `AST` where KSP
    writes `ASR`.
- **`Logs/ModuleManager/MMPatch.log`.**
  - Only on startups that patch from scratch ("cold").
  - The patch log proper. Its lines are also in `ModuleManager.log`.

`PostPatchLoader.Run` copies the whole `ModuleManager.log` into KSP.log as a
single log entry: the **dump** (see 1.6). Almost every MM diagnostic, such as
errors, cache decisions and passes, reaches KSP.log only inside it.
- Lines inside the dump keep their own `[LOG hh:mm:ss.fff]` stamps.
- These stamps are **earlier** than the dump's position in the file, by up
  to the whole patching time.

### 1.1 Where MM runs in the Countdown

**What happens** `[C]`

1. `GameDatabase.LoadObjects` (KSP) logs the mod list. Then, in the same
   coroutine step with no yield in between, it:
   - calls `AddonLoader.StartAddons(Instantly)`;
   - calls `SetupMainLoaders()`;
   - parses every config file (`new UrlDir(...)`).

   With KSPCF's FastLoader, `SetupMainLoaders` instead starts KSPCF's
   loader, and that loader's first step also runs synchronously (area 4).
   All of this is one frame.
2. MM's `ModuleManager` addon is `[KSPAddon(Instantly)]`. Its `Awake`:
   - inserts `PostPatchLoader` into the loading screen's loader list, right
     after `GameDatabase`, so before `PartLoader`. Other mods can insert
     loaders there too. `[R]` On KSP-bench, Kopernicus's `MeshPreloader`
     runs between `GameDatabase` and `PostPatchLoader`;
   - starts the coroutine `MMPatchRunner.Run`;
   - sets `targetFrameRate` and `vSyncCount` for faster loading, and
     restores them at the main menu.
3. `MMPatchRunner.Run` first starts the logging thread and then yields
   twice. Its next step therefore waits until the frame from step 1 ends.
4. Then, on the main thread, `ModListGenerator.GetAdditionalModsFromStaticMethods`
   scans every type of every loaded assembly, and every active
   `MonoBehaviour`, for `ModuleManagerAddToModList`.
5. Then it starts the patching thread, `MMPatchLoader.Run`:
   - **every startup:** SHA256 of every config file, read again from disk;
     then the cache check (1.2);
   - **cold only:** the mod list, with a SHA256 of every DLL; patch
     extraction; every pass; the cache write; the Physics and TechTree
     files;
   - **when the cache is used:** the cache file is loaded instead;
   - **at the end, in both cases:** `Localizer.SwitchToLanguage`.
6. While MM patches, the main thread keeps loading assets in
   `GameDatabase`.
7. When the loading screen reaches `PostPatchLoader`, the main thread waits
   for the patching thread to finish. This wait is the time MM adds to the
   critical path.
8. Then `PostPatchLoader` runs on the main thread (1.5).

**What controls it**
- **Patching time:** the number of config files and patches.
- **When patching can start:** everything else that runs in the frame of
  step 1. That includes other `Instantly` addons' `Awake`, the config
  parse, and FastLoader's first step.
- **How long the main thread waits:** how much asset loading `GameDatabase`
  still has to do. The wait is MM's total minus that overlap.

**Evidence**

| Line | Writer | Sink |
|---|---|---|
| `[ModuleManager] Adding post patch to the loading screen {n}` | `ModuleManager.Awake` | KSP.log |
| `[ModuleManager] Patching started on a new thread, all output will be directed to {path}` | `MMPatchRunner.Run` | KSP.log |
| `Calling {Assembly}.{Type}.ModuleManagerAddToModList()` | `ModListGenerator` | dump |
| `Checking Cache` (patching thread starts) | `MMPatchLoader.Run` | dump |
| `SHA generated in {F3}s` | `MMPatchLoader.IsCacheUpToDate` | dump |
| `Ran in {F3}s` (the whole patching thread) | `MMPatchLoader.Run` | dump |
| `[ModuleManager] Waited {F3}s for patching to finish` | `PostPatchLoader.Run` | KSP.log |
| `[ModuleManager] Post patch ran in {F3}s` | `PostPatchLoader.Run` | KSP.log |
| `[ModuleManager] Total loading Time = {F3}s` (from MM's `Awake` to the main menu, not from process start) | `ModuleManager.Update` | KSP.log |

All present in MM 4.0.0 to 4.2.3 with the same text `[C]` (`git grep` over the
tags).

Profiler: the loader span `ModuleManager.PostPatchLoader` equals `Waited` +
`Post patch ran in`.

`[R]` KSP-bench run `20261015-043911`:
- `Waited 65.452s` + `Post patch ran in 5.252s` = 70.70 s, and the
  profiler's `PostPatchLoader` span is 70.707 s.
- `Ran in 88.662s`.
- `Patching started` is at 04:31:28.906, but `Checking Cache` only at
  04:31:52.243: the patching thread started 23 s after MM's `Awake`. The
  profiler shows the main thread busy in that window with `Instantly`
  addons' `Awake` and the config parse (`gameDatabase.urlDir`, 10.9 s).

**Robustness**
- The worker-thread numbers (`Ran in`, `SHA generated in`) use `F3` without
  an invariant culture, on threads where KSP did not set the culture. They
  may print `88,662s` on systems with a comma decimal separator `[I]`.
  Parse both separators.
- The main-thread numbers always use `.` `[C]`.
- MM before 4.0 has no dump and no `Waited` line. Rules need the dump and
  report nothing about MM without it.

**Coverage**
- `Waited` is the cost in `mm-cache-not-saved` (M3).
- **Candidate:** a ModuleManager breakdown of the Countdown: start delay,
  patching (`Ran in`), main-thread wait (`Waited`), post-patch (`Post patch
  ran in`).

**Player action:** informational. The breakdown shows whether MM is on the
critical path and by how much.

### 1.2 Config cache: when it is used

**What happens** `[C]`

`MMPatchLoader.IsCacheUpToDate` decides whether this startup patches from
scratch.

1. **The SHA.** It computes one SHA256 over:
   - for every config file, in order: its URL with extension, then its raw
     bytes;
   - every loaded assembly's URL and name. **Not its content or version.**
     Replacing a DLL with a new build under the same name does not
     invalidate the cache;
   - every name returned by `ModuleManagerAddToModList`;
   - a constant.
   - It also keeps a SHA per config file.
2. **The cache is used only if all of these hold:**
   - `GameData/ModuleManager.ConfigSHA` exists, parses, and has `SHA`,
     `version` and `KSPVersion`;
   - no config file changed, was added or was deleted;
   - the global SHA matches;
   - MM's assembly version matches;
   - the KSP version (`major.minor.revision.build`) matches;
   - `ModuleManager.ConfigCache`, `ModuleManager.Physics` and
     `ModuleManager.TechTree` all exist in `GameData`.
3. If the check throws, MM patches from scratch. An example is a SHA file
   without a `FilesSHA` node.

There is no setting or command-line option that forces or disables the cache
`[C]`.

**What controls it**
- **Any change to a config file, or to the set of DLLs and their paths.**
  Installing, updating, moving or removing a mod changes these. So does any
  file a mod writes under `GameData` with a `.cfg` extension. Moving a
  folder also counts, because paths are hashed.
- **Updating MM or KSP.**
- **A previous cold startup that did not save the cache** (1.3). Its files
  are gone, so this startup is cold too.
- **No `TechTree` node after patching.** `SaveModdedTechTree` then writes
  no `ModuleManager.TechTree`, and the next check fails. The same holds for
  `PHYSICSGLOBALS` and `ModuleManager.Physics`, but MM always injects
  `Physics.cfg` as a `PHYSICSGLOBALS` node, so that one is unlikely `[I]`.

**Evidence** (all in the dump; `MMPatchLoader.IsCacheUpToDate` and `CheckFilesChange`) `[C]`

| Reason for a cold startup | What the dump shows |
|---|---|
| No usable SHA file (first run, previous cold run with errors, previous failed write) | `SHA generated in`, `      SHA = ...`, and **no** `Cache SHA =` / `useCache =` line before `Pre patch init` |
| Config files changed | A `Changes :` entry with `Changed : {file}.cfg` (MM appends `.cfg` to a name that already has it: `x.cfg.cfg`), `Added   : {url}` and `Deleted : {file}` lines, then `useCache = False` |
| Global SHA only (DLLs, paths, mod list) | No `Changes :`; `Cache SHA = {a}` differs from `SHA = {b}`; `useCache = False` |
| MM or KSP version, or a missing ConfigCache, Physics or TechTree file | SHAs equal, no `Changes :`, `useCache = False`. **The log cannot tell these apart** |
| The check threw | `Exception in IsCacheUpToDate` (EXC) and no `useCache =` |
| Cache used | `useCache = True`, `Loading from Cache`, `Cache Loaded`, and the status `ModuleManager: {n} patch(es) loaded from cache` |
| No TechTree node (the next startup will be cold too) | `No TechTree node found. No custom TechTree will be saved` |

`[R]` KSP-bench, every run: no `useCache =` line. This is the "no usable SHA
file" row, as expected after a previous cold run with errors.

**Robustness**
- The same strings are in MM 4.0.0 to 4.2.3 `[C]`.
- The table's rows are told apart by which lines are **present**. When none
  of the expected lines is there (an unknown MM version, or no dump), the
  rule names no reason.
- The version-or-missing-file row stays one undivided reason.

**Coverage:** candidate rule, *ModuleManager patched from scratch*.
- Cost: `Waited` (measured).
- Reason: from the table above.
- Without errors, a cold startup after a change is expected once, so the
  finding is informational.
- It becomes a problem when the evidence says the next startup will be cold
  too: errors (1.3), or no TechTree node.

**Player action**
- **After installing or updating mods:** none. The next startup uses the
  cache.
- **No TechTree node:** report it to the mod whose patch deletes or
  replaces the tech tree.

### 1.3 Patch errors, exceptions and the unsaved cache

**What happens** `[C]`

1. `PatchProgress` counts warnings, errors and exceptions, and remembers the
   file each one came from.
2. After the last pass, `MMPatchLoader.Run` logs one warning line per file
   with warnings.
3. If errors + exceptions > 0, it:
   - builds one `{n} error(s) related to GameData/{file}` line per file with
     errors;
   - logs `Errors in patch prevents the creation of the cache`;
   - **deletes** `ModuleManager.ConfigCache` and `ModuleManager.ConfigSHA`.

   Otherwise `CreateCache` writes both files.
4. A write that throws makes MM delete both files again. So does a failed
   SHA write followed by a successful cache write, which leaves a stale or
   missing SHA.
5. Exceptions:
   - inside a patch: caught per target node (`EditPatch`, `CopyPatch`,
     `DeletePatch.Apply`) and per patch (`PatchApplier.ApplyPatches`);
     patching goes on;
   - a patch that threw is not counted as applied, so the status line shows
     a percentage.
   - `NeedsChecker` logs and then rethrows, so one failure there counts as
     two exceptions.

**What errors are.** Malformed patch names, an empty `:NEEDS`, `:HAS`,
`:BEFORE`, `:FOR`, `:AFTER` or `:LAST`, operators not valid where they are
used, variable searches that do not parse, failed maths or regex
replacements, and a copy with the parent's name. The full message list is
in `PatchExtractor`, `ProtoPatchBuilder`, `NeedsChecker`,
`MMPatchLoader.ModifyNode` / `FindAndReplaceValue`, and `CopyPatch`.

**What is not an error.** None of these block the cache:
- **Warnings:** unknown tags, more than one `:NEEDS` or `:HAS`, and
  similar.
- **Unsatisfied `:NEEDS`, `:BEFORE` and `:AFTER`:** logged as
  `Deleting ... as it can't satisfy its NEEDS`.
- **Variable-search misses:** `Cannot find key ...`.
- **A patch that matches nothing:** this is silent.

**What controls it:** the patch files of every mod, and their interaction
with the other mods installed. An error is often a compatibility patch for
a mod version other than the one installed.

**Evidence** (`MMPatchLoader.Run`, `StatusUpdate`, `PatchProgress`) `[C]`

| Line | Sink |
|---|---|
| `Errors in patch prevents the creation of the cache` (WRN) | dump |
| `ModuleManager: {n} patch(es) applied[ ({P0})][, found <color=yellow>{n} warning(s)</color>][, found <color=orange>{n} error(s)</color>][, encountered <color=red>{n} exception(s)</color>]`. `{n} patches` counts node applications, not patch files | dump |
| `{n} error(s) related to GameData/{file}`: lines **without** a timestamp, right after the status line (the status and the list are one log entry) | dump |
| `{n} warning(s) related to GameData/{file}` (WRN) | dump |
| `Exception while applying {update/copy/delete} {patch} to {node}` (EXC), or `Exception while processing node : {patch}` (EXC) followed by `Processed node was` (ERR) | dump |
| `Exception while saving the sha`, `Exception while saving the cache`, `NullReferenceException while saving the cache` (EXC), `An error occured while creating the cache. Deleting the cache files to avoid keeping a bad cache` (ERR) | dump |
| Success: `Saving Cache`, then `Saving cache` | dump |

Each error line is preceded in the dump by the `Applying update/copy/delete
{patch} to {node}` it happened in, which names the patch and the target.
Exceptions logged without a URL count, but appear in no per-file line. These
come from `NeedsChecker` and from the DLL SHA in `ModListGenerator`.

`[R]` KSP-bench:
- `ModuleManager: 35328 patches applied, found <color=yellow>16 warnings</color>, found <color=orange>4 errors</color>`;
- one `4 errors related to GameData/ChemicalPropulsion/...` line;
- `Errors in patch prevents the creation of the cache`.

**Robustness**
- Same strings in MM 4.0.0 to 4.2.3 `[C]`.
- The colour tags are part of the text: match the counts, not the markup.
- **In a startup that used the cache, the dump nests the previous cold
  run's `MMPatch.log`** (1.6). Its lines must never count as this run's
  events. In practice it cannot contain `Errors in patch prevents...`,
  because an error-free cold run is the only way to get a cache. A rule
  still has to stay outside the nested block.

**Coverage**
- `mm-cache-not-saved` (M3) covers errors.
- **Candidates:**
  - count exceptions and failed cache writes too;
  - flag the ` ({P0})` percentage (a patch threw);
  - read only this run's part of the dump.

**Player action:** fix or remove the patch file named, or report it to the
mod that ships it. When patching has no errors, MM saves the cache, and
later startups skip patching until something changes.

### 1.4 PartDatabase.cfg deleted on every cold startup

**What happens** `[C]`
1. On a cold startup, `MMPatchLoader.Run` deletes `<KSP root>/PartDatabase.cfg`
   right after building the mod list.
   - The exception is a "Quick Reload Database" from MM's own in-game menu,
     which sets `MMPatchLoader.keepPartDB`.
   - The cache path leaves the file alone.
2. In KSP, `PartLoader.CompileAll` → `InitializePartDatabase` finds no file.
   - Every part then has no database record (`GetDatabaseConfig`).
   - `DragCubeSystem.SetupDragCubeCoroutine` therefore renders its drag
     cubes again instead of loading the stored `DRAG_CUBE` nodes.
3. `SavePartDatabase` writes the file again at the end of loading.

**What controls it:** MM's cache state alone. A startup that uses the cache
keeps the drag cubes. A startup that cannot save the cache (1.3) regenerates
them **on every startup**.

**Evidence**
- MM writes no line for the deletion `[C]`.
- KSP writes:
  - `PartLoader: Creating part database`;
  - per part, `PartLoader: Part '{url}' has no database record. Creating.`;
  - `[DragCubeSystem]: Drag cubes not found or cannot be read for part {name}. Generating New drag cubes.`;
  - `DragCubeSystem: Creating drag cubes for part '{name}'`.
- KSPCF's `DragCubeGeneration` writes `[KSPCF/DragCubeGeneration] Creating drag cubes for part '{name}'` instead (area 3).
- `[R]` KSP-bench: `PartLoader: Creating part database`, and 1,650
  `Creating drag cubes` lines.

**Robustness**
- The KSP lines are stable for 1.12.x.
- The link to MM is inferred from the cold-startup evidence (1.2/1.3), not
  logged.
- The rule must not blame MM when the cold evidence is missing. Drag cubes
  also regenerate when a part's file timestamps change (area 3).

**Coverage:** `drag-cubes-regenerated` (M3), related to `mm-cache-not-saved`.
Its detail belongs to area 3.

**Player action:** follows from 1.3. Once MM saves its cache, drag cubes
are reused.

### 1.5 Post-patch stage and `ModuleManagerPostLoad` callbacks

**What happens** (`PostPatchLoader.Run`, main thread) `[C]`

1. **Swap the database:** clear every config file's nodes and add the
   patched ones. One frame.
2. **Dump** `ModuleManager.log` into KSP.log (1.6). Two frames.
3. **Reload the definitions `GameDatabase` already built from the unpatched
   configs:**
   - resources (`PartResourceLibrary.LoadDefinitions`);
   - traits (`LoadTraitConfigs`);
   - part upgrades (`FillUpgrades`);
   - modded physics (`PhysicsGlobals.LoadDatabase`).

   One frame.
4. **Registered callbacks** (`PostPatchLoader.AddPostPatchCallback`): each
   one is followed by a frame. No line per callback and no timing.
   - KSPCF inserts its `MMPostLoadCallback` at index 0 of this list
     (`KSPCommunityFixes.Start`). **KSPCF applies all its Harmony patches
     here** (area 2).
5. **Static `ModuleManagerPostLoad()`:** a reflection scan of every type of
   every loaded assembly. Each method found is logged, then invoked. There
   is no yield between calls.
6. **Instance `ModuleManagerPostLoad()`:** on every active `MonoBehaviour`.
   Each call is logged, then invoked.
7. Optional `-mm-dump` export (1.8). Then `Post patch ran in`.

**What controls it:** every mod with a `ModuleManagerPostLoad` method or a
registered callback; KSPCF's patching; the size of the database.

**Evidence** (all direct to KSP.log, `[ModuleManager]` prefix) `[C]`
- `Running post patch callbacks`.
- `Calling {Assembly}.{Type}.ModuleManagerPostLoad()` (static). An
  exception logs `Exception while calling {Assembly}.{Type}.ModuleManagerPostLoad()`
  (EXC).
- `Calling {Type}.ModuleManagerPostLoad()` (instance). An exception logs
  `Exception while calling {Type}.ModuleManagerPostLoad() :` (EXC).
- `Exception while running a post patch callback` (EXC, registered
  callbacks).
- `Post run call threw an exception in loading {assembly}` (EXC). The rest
  of that assembly's callbacks are skipped.
- `Post patch ran in {F3}s`.

Because each `Calling` line is written just before the call, the time to the
next `[ModuleManager]` line is an **upper bound** for that callback. It also
includes the reflection scan of the types in between. The last static call
also includes one frame.

`[R]` KSP-bench run `20261015-043911`:
- **15 callbacks.** From `Calling ParallaxContinued.ConfigLoader.ModuleManagerPostLoad()`
  (04:33:22.864) to the next `Calling` (04:33:25.049): 2.2 s.
- **Registered callbacks and the start of the scan:** from `Running post
  patch callbacks` to the first `Calling`, 1.3 s. KSPCF's patching is part
  of this.

**Robustness**
- Same strings in MM 4.0.0 to 4.2.3.
- Instance calls name only the type, not the assembly. Map the type to a mod
  only through the run's `Load(Assembly)` lines, and otherwise report the
  type name.
- Lines the mods write inside their callback sit between two `Calling`
  lines. They do not change the bound.

**Coverage:** candidate rule, *expensive ModuleManager post-load callback*.
- **Cost:** per callback, estimated (upper bound from timestamps).
- **Level:** works from KSP.log alone. The profiler does not time these
  calls today.
- **KSPCF's part** cannot be separated from the log, and is left to area 2.

**Player action:** report the cost to the mod. It runs on every startup,
whether the cache was used or not.

### 1.6 The MM log in KSP.log, and what it says about each node

**What happens** `[C]`
- **Every startup** that reaches `PostPatchLoader` logs one entry:
  `[ModuleManager]`, a line `#### BEGIN MODULEMANAGER LOG ####`, the whole
  `ModuleManager.log`, then `#### END MODULEMANAGER LOG ####`. This holds
  for cold startups, cache startups and reloads from MM's menu.
- **When the cache was used**, `ModuleManager.log` contains `Dumping patch
  log` followed by the previous cold run's `MMPatch.log`, between `####
  BEGIN PATCH LOG ####` and `#### END PATCH LOG ####`. That log's `Log
  started at {date}` and every timestamp in it belong to **that earlier
  startup**.
- **The dump is missing when:**
  - `-mm-dont-copy-logs` was given (`[ModuleManager] Not dumping log because -mm-dont-copy-logs was set`);
  - `ModuleManager.log` is missing (`[ModuleManager] ModuleManager log does not exist: {path}`, ERR);
  - the patching thread died (1.7);
  - the game closed before `PostPatchLoader`.

**What the patch log records per node** `[C]`
- **Only which patch applied to which node:**
  - `Applying update {patch} to {node}`, and likewise `copy` and `delete`;
  - for loop patches, `Looping on {patch} to {node}`.
- **Format:**
  - `{patch}` is the patch file's URL plus the node header as written,
    e.g. `KSPCommunityFixes/MMPatches/ModSupport/UniversalStorage/@KSP_COMMUNITY_FIXES:NEEDS[UniversalStorage2]`;
  - `{node}` is the target file plus the node type and name, e.g.
    `KSPCommunityFixes/Settings.cfg/KSP_COMMUNITY_FIXES`.
- **No values and no diffs.** Value-level tracing exists only under the
  `LOGSPAM` compile symbol, which release builds do not define.
- **Each pass start is logged** as `{pass} pass`, even when the pass is
  empty. Examples: `:FIRST pass`, `:BEFORE[MOD] pass`, `:FOR[MOD] pass`,
  `:FINAL pass`.
  - Mod names are upper-cased.
  - The timestamps between pass lines give the time per pass.

**Where final values are** `[C]`
- **`GameData/ModuleManager.ConfigCache`:** every patched top-level node,
  with escaped values. It is written only by an error-free cold startup.
- **The `-mm-dump` option, or "Dump Database to Files" in MM's menu:**
  every final config file under `<KSP root>/_MMCfgOutput/`. Each file is
  logged as `[ModuleManager] Exporting {file}`.
- **Not in KSP.log.** KSP's own `Config({type}) {url}` lines list nodes
  without values, and only from the unpatched database.

So **KSP.log cannot say what a patch changed**: for example, which value
`@KSP_COMMUNITY_FIXES` patches left on `ForceSyncSceneSwitch`. A tool can
get final values only from `ModuleManager.ConfigCache`, when the cache
exists. That input is outside KSP.log and belongs to the area 2 decision.

**Robustness**
- Markers and per-node formats are the same in MM 4.0.0 to 4.2.3.
- Lines inside the dump have their own timestamps, from the worker thread.
  They are not part of the main thread's timeline.
- A size limit on one Unity log entry was not checked.

**Coverage**
- Infrastructure for every MM rule.
- **Candidate:** when the dump is missing, the report says that the MM
  rules had no evidence, instead of reporting nothing.

**Player action:** none.

### 1.7 Patching thread failure

**What happens** `[C]`
- An exception that escapes `MMPatchLoader.Run`, for example while loading
  a damaged cache file in `LoadCache`, kills the patching thread.
- `MMPatchRunner` then:
  - logs it;
  - shows `FatalErrorHandler`'s dialog ("ModuleManager has encountered a
    fatal error and KSP needs to close...");
  - never hands configs to `PostPatchLoader`.
- Loading stops at "ModuleManager: Waiting for patching to finish". No dump
  is written.

**Evidence:** `[ModuleManager] The patching thread threw an exception: {exception}`
(EXC) or `[ModuleManager] The logging thread threw an exception: {exception}`
(EXC), direct to KSP.log `[C]`.

**Robustness:** same strings in MM 4.x.

**Coverage**
- Candidate rule: *ModuleManager failed: loading cannot finish*.
- No cost: the Countdown never ends.

**Player action:** the cause is in the exception. A damaged cache can be
removed by deleting `GameData/ModuleManager.ConfigCache` and
`ModuleManager.ConfigSHA`, which forces one cold startup.

### 1.8 Other MM costs

All `[C]`.

- **SHA of every config file, on every startup.** Every `.cfg` is read a
  second time on the worker thread. Evidence: `SHA generated in {F3}s`.
- **SHA256 of every DLL file, on cold startups.** In `ModListGenerator`.
  The dump's mod-list table shows it.
- **Two reflection scans on the main thread:** `ModuleManagerAddToModList`
  before patching (1.1), and `ModuleManagerPostLoad` after it (1.5). Each
  calls `GetTypes()` on every loaded assembly.
- **The dump itself.** `File.ReadAllText` plus one large log entry on the
  main thread. A cold run's dump has one line per node application: the
  bench's is about 42,000 lines.
- **The `-mm-dump` option.** It exports the whole database on every startup
  where it is set.
  - KSP lists the command line in its environment block at the top of
    KSP.log.
  - Each exported file logs `Exporting {file}`.
  - **Candidate rule:** *ModuleManager exports the database on every
    startup*. Action: remove `-mm-dump` when not debugging patches.
- **Database reload from MM's menu** (KSP's modifier key + F11, in the
  space center or the main menu). This reruns:
  - the cache check;
  - patching;
  - the dump;
  - all callbacks.

  Stock's debug-menu reload runs neither MM's patching nor its callbacks.
  Not a Countdown or Hold cost.
- **`CustomConfigsManager`** (Space Center addon). It switches the career's
  tech-tree URL to `ModuleManager.TechTree` when that file exists, and logs
  `[CustomConfigsManager] Setting modded tech tree as the active one`. The
  cost is negligible `[I]`.
- **Several copies of MM.** An election picks one and logs `version {v} at
  {path} won the election against` / `lost the election`. This is not a
  loading cost.
- **MM's version.** KSP's `Mod DLLs found:` list shows `ModuleManager
  v4.2.3.0` `[R]`. MM writes no version line of its own.

### Area 1: candidate rules for M5

| Candidate | Evidence | Level | Notes |
|---|---|---|---|
| ModuleManager breakdown of the Countdown (informational) | `Patching started` → `Checking Cache` (start delay), `Ran in`, `Waited`, `Post patch ran in` | log | Shows whether MM is on the critical path. Accept `,` in worker-thread numbers |
| ModuleManager patched from scratch, with the reason | 1.2 table; cost `Waited` | log | Informational after a change; a problem when the next startup will be cold too |
| Next startup will be cold too: no TechTree node | `No TechTree node found...` | log | Cache can never be used |
| Extend `mm-cache-not-saved` | exceptions, failed cache writes, ` ({P0})` | log | Read only this run's part of the dump |
| Expensive post-load callback | `Calling ...ModuleManagerPostLoad()` timestamps | log | Upper bound; mod from `Load(Assembly)`, else the type name |
| ModuleManager failed | `The patching thread threw an exception` | log | No cost; the Countdown never ends |
| ModuleManager exports the database every startup | `-mm-dump` in the args, `Exporting` lines | log | Cost from the `Exporting` timestamps |
| MM evidence missing | no dump markers, or `Not dumping log because -mm-dont-copy-logs was set` | log | Said in the report, not a finding |

Not detectable from KSP.log: which of MM version, KSP version or a missing
cache file made a startup cold (1.2), and what any patch changed (1.6).

### Area 1: analyzer issues found

Fixed with this area (2026-10-15):

1. **`mm-cache.ts` guessed when the dump was missing.** It fell back to the
   whole log. It now reports nothing without the startup's complete dump.
   Saying in the report that the MM evidence is missing is a candidate
   above.
2. **Dump lines were parsed as ordinary log lines.**
   - Their timestamps run up to minutes behind their position in the file,
     so `gaps()` could mix two clocks.
   - Worse, on a startup that used the cache, the nested patch log's
     timestamps come from an earlier session. When that session's time of
     day was more than an hour later, the midnight detection moved **every
     later line one day ahead**, and with it the log's alignment with the
     profiler.
   - `parseLog` now keeps the dump out of the timeline: `Run.log` is the
     timeline, and `Run.mmDumps` holds each dump with this startup's MM
     lines and the nested patch log apart.
3. **The nested patch log belongs to an earlier startup** (1.3, 1.6).
   - `mm-cache-not-saved` reads only this startup's lines.
   - `buffered-scene-switch` (formerly `kspcf-optimization-off`) reads the
     patch applications from both parts.
     The nested patch log is the log of the startup that built the cache in
     use, so it lists the patches behind the current configs.

Left for the step that owns them:

4. **Worker-thread numbers can use `,`** (1.1). No current rule reads them.
   The M5 rules that do must accept both separators.
5. **The profiler misses the first long loading frame.** On run
   `20261015-043911`, about 22 s of main-thread work (`Instantly` addons'
   `Awake`, the config parse, FastLoader's start) lies between profiler
   t ≈ 11.7 s and 33.7 s, but no `frame.long` covers it. Explained in 4.1:
   the frame monitor has no earlier timestamp for its first frame; the fix
   is a profiler change (M5).

---

## 2. KSPCommunityFixes across versions

KSPCommunityFixes (KSPCF) is a set of Harmony patches to stock KSP: bug fixes,
quality-of-life changes and performance work, several of them on loading and
scene switches. Most patches are switched by keys in its settings. Mods can
change those settings through ModuleManager patches, sometimes trading a
speed-up for compatibility.

The question for T-Minus: which patches are off on this install, who turned
them off, and does it cost loading time? The answer has to hold for any KSPCF
version, without a table per version.

Paths are relative to `KSPCommunityFixes/` in the KSPCF repository (tag
`1.41.1`). The history was checked over the tags 1.0.0 to 1.41.1.

### 2.1 Which patches apply

**What happens** `[C]`
1. **The `KSPCommunityFixes` addon** (`KSPCommunityFixes.cs`,
   `[KSPAddon(Instantly)]`). In `Start`, it inserts its `MMPostLoadCallback`
   at index 0 of ModuleManager's registered post-patch callbacks. That
   field is private, so it does this through reflection. KSPCF therefore
   patches inside MM's post-patch stage (1.5), after MM has swapped in the
   patched configs.
2. **`MMPostLoadCallback` reads the settings.**
   - It reads the `KSP_COMMUNITY_FIXES` nodes from `GameDatabase`. It uses
     the node only if **exactly one** exists; otherwise the settings are
     empty, and nothing is logged.
   - Every top-level value that is `true`, or is not a boolean, enables
     the key of the same name.
3. **It applies every `BasePatch` subclass.**
   - Order: `[PatchPriority]`. Classes with `[ManualPatch]` are skipped.
   - **The key is the class name.**
   - `BasePatch.Patch` checks in this order:
     1. `CanApplyPatch` (a missing DLC, or a patch it depends on);
     2. the key, unless the patch overrides `IgnoreConfig`;
     3. the KSP version range (1.12.0 to 1.12.99 by default);
     4. the Harmony application itself.
4. **Some code is always on, with no key:**
   - `KSPCFFastLoader` (on KSP 1.12.3 and later);
   - `ConfigNodePerf`;
   - `ReflectionTypeLoadExceptionHandler`;
   - `GameDatabasePerf`, applied from FastLoader at `Instantly`;
   - `PatchSettings`.
5. **Defaults exist only as data.** A patch whose key is missing is off. The
   shipped `GameData/KSPCommunityFixes/Settings.cfg` is the only place
   that says what is on by default.
   - Its comments and section headers do not match the code, so read its
     values, not its comments.
   - Namespaces do not match categories either: `ForceSyncSceneSwitch` and
     `SceneLoadSpeedBoost` are in the root namespace.
   - There is no category attribute.

**What controls it**
- The installed `Settings.cfg`, which a player can also edit by hand.
- ModuleManager patches on `KSP_COMMUNITY_FIXES` (2.2).
- The DLCs installed, and the KSP version.

**Evidence:** one line per patch, from `BasePatch.Patch`, direct to KSP.log
`[C]`.

| Outcome | 1.37 to 1.41.1 | 1.10 to 1.36 |
|---|---|---|
| Applied | `[KSPCommunityFixes] Patch {Class} applied.` | same |
| Not applicable (`CanApplyPatch`) | `[KSPCommunityFixes] Patch {Class} not applied ({reason})` | same |
| Off in settings | `[KSPCommunityFixes] Patch {Class} not applied (not enabled in Settings.cfg)` | `... not applied (disabled in Settings.cfg)` |
| Outside the KSP version range | `[KSPCommunityFixes] Patch {Class} isn't applicable to this KSP version.` | same |
| Error | `[KSPCommunityFixes] Patch {Class} not applied, error applying patch` (ERR, after the exception; 1.36+) | `... not applied : {exception}` (ERR) |

Harmony validation problems are logged as warnings named after the full
type, e.g. `[KSPCommunityFixes.Performance.LocalizerPerf] Target method not
for found for ...` ("not for found" is the actual text).

KSPCF writes **no** line with a setting's value, the default, or the list of
keys. Its version is in two places:
- KSP's `Mod DLLs found:` list, e.g.
  `KSPCommunityFixes v1.41.0.0 / v1.41.1+{commit} / v1.41.1.0`
  (AssemblyVersion / informational / file version);
- `AssemblyLoader: KSPAssembly 'KSPCommunityFixes' V1.41.1` `[R]`.

`[R]` KSP-bench run `20261015-043911`:
- 112 `applied.` lines;
- 14 `not enabled in Settings.cfg` lines;
- 1 `isn't applicable to this KSP version.` line (`StockAlarmCustomFormatterDate`,
  whose upper limit is KSP 1.12.3).

**Robustness**
- **The text of the "off" reason changed in 1.37.** A rule must parse the
  line's structure: `Patch {Class} applied.`, or `Patch {Class} not applied
  ({reason})`, with a reason that names `Settings.cfg`. A literal match of
  one version's text misses the others.
- **Class names are the stable identifiers,** and they are also the keys.
- **Fail closed on unknown line forms:** parse what is known, and count
  nothing else.
- **A missing patch line means "not in this version", never "off".**
- **KSPCF before 1.10** used other formats. It is not supported.

**Coverage:** `kspcf-optimization-off` (M3) read these lines. It matched
only the 1.37+ text, so it was blind on older versions. This is fixed with
this area (see "Area 2: analyzer issues").

**Player action:** none by itself. See 2.4 for the case that costs time.

### 2.2 Who changes KSPCF's settings

**What happens** `[C]`
- **ModuleManager patches on `KSP_COMMUNITY_FIXES`** are applied like any
  other MM patch (1.6). They come from three kinds of source:
  - **KSPCF's own compatibility patches,** under
    `GameData/KSPCommunityFixes/MMPatches/ModSupport/`. In 1.41.1 they are:
    - `UniversalStorage.cfg`: `ForceSyncSceneSwitch = false` when
      UniversalStorage2 is installed;
    - `KSPRecall.cfg`: `BetterEditorUndoRedo = false` when KSP-Recall's
      AttachedOnEditor is installed.
  - **Other mods' patches,** in their own folders.
  - **The player's own patch:** KSPCF ships
    `Extras/KSPCF_UserSettings.cfg.extra`, a template for an
    `@KSP_COMMUNITY_FIXES:AFTER[KSPCommunityFixes]` patch.
- **Hand edits to `Settings.cfg`** leave no trace.
- **A second root `KSP_COMMUNITY_FIXES` node** turns every keyed patch off
  (2.1, step 2). It can come from another mod's file, or from an MM copy.
- **`PluginData/*.cfg`** files written by KSPCF's settings screen
  (`PatchSettings`) only change behavior inside a few patches:
  - `NoIVA`;
  - the PNG texture cache;
  - the Making History opt-out;
  - the maneuver tool;
  - the altimeter.

  They never switch a keyed patch on or off.

**Evidence**
- **MM patch lines** (1.6), in the startup's dump: `Applying update
  {patch} to KSPCommunityFixes/Settings.cfg/KSP_COMMUNITY_FIXES`. On a
  startup that used the cache, they are in the nested patch log. `{patch}`
  is the patch's file path and header, which name the mod (folder or
  `:NEEDS[...]`).
- **The duplicate-node signature:** every keyed patch logs the "off in
  settings" reason. Only the patches that ignore the config, such as
  `PatchSettings`, log `applied.`.

`[R]` KSP-bench: three patches apply to the node:
- KSPCF's own `UniversalStorage` patch (`:NEEDS[UniversalStorage2]`);
- `KerbalJointReinforcement/KSPCommunityFixes/@KSP_COMMUNITY_FIXES:AFTER[KSPCommunityFixes]`;
- `Kopernicus/Config/KSPCF_DisableMapSOPatches/@KSP_COMMUNITY_FIXES:FINAL`.

**Robustness**
- MM's line names the patch, not the keys it changed (1.6). From KSP.log
  alone, a patch is a **candidate** for a key, never proven.
- The installed `Settings.cfg` is not in KSP.log. A log-only reader cannot
  know a key's default, or whether a hand edit changed it.

**Coverage**
- `buffered-scene-switch` lists the MM patches as candidates when the reason is the settings.
- **Candidate rule (profiler):** at the main menu, the profiler reads the
  installed `Settings.cfg` from disk, unpatched, and KSPCF's effective node
  (`KSPCommunityFixes.SettingsNode`, public, read-only). It writes the keys
  whose value differs to KSP.log.
  - This gives each key's installed and effective value, with no table and
    for any version. MM's patch lines then name the candidates.
  - It reads public state only. It never instantiates patch classes or
    touches their statics: `ApplyPatches` and some static constructors have
    side effects.
- **Candidate rule (log):** the duplicate-node signature, *KSPCF's settings
  were not read*.

**Player action**
- For a mod's compatibility patch, the trade-off is the mod against the
  speed-up (2.4).
- For a duplicate node, remove the extra `KSP_COMMUNITY_FIXES` node.

### 2.3 KSPCF's own patching time

**What happens** `[C]`
- `MMPostLoadCallback` applies about 125 patches through Harmony on the main
  thread, as MM's first post-patch callback (1.5).
- Each Harmony patch compiles a replacement for its target method. That
  makes this work proportional to the number of patches applied (area 7).
- `GameDatabasePerf` applies earlier, at `Instantly`.

**Evidence**
- No timing line. The work lies between MM's `Running post patch
  callbacks` and the next MM line.
- The first and last `[KSPCommunityFixes] Patch ...` lines inside that
  stretch bound it.
- `[R]` KSP-bench: from 04:33:21.252 to 04:33:22.504, so 1.25 s, for 112
  patches.

**Robustness:** it depends only on the per-patch lines (2.1) and MM's
markers (1.5).

**Coverage:** candidate, as part of the ModuleManager post-patch breakdown
(1.5). Informational.

**Player action:** none. It is the cost of KSPCF's fixes, paid on every
startup.

### 2.4 Scene-switch mode and `ForceSyncSceneSwitch`

**What happens** `[C]`
1. `HighLogic.LoadScene` asks `SceneTransitionMatrix.GetTransitionValue(from, to)`.
   The matrix is scene data, not code.
2. **If true**, `bufferedLoad(async)` runs:
   - it loads the empty loading-buffer scene;
   - it calls `Resources.UnloadUnusedAssets` and `GC.Collect`;
   - then it loads the target with `LoadSceneAsync`.
3. **If false**, `SceneManager.LoadScene` loads the target directly.
4. KSPCF's `ForceSyncSceneSwitch` (since 1.36.0) replaces
   `GetTransitionValue` with `false`, so every switch is direct.
5. `HighLogic.LoadSceneFromBundle` (the mission builder) is always buffered.

**What controls it:** whether `ForceSyncSceneSwitch` is applied (2.1, 2.2).
In 1.41.1, KSPCF itself turns it off when UniversalStorage2 is installed.

**Evidence:** `HighLogic.SetLoadSceneEventsAndFlags` logs every switch with
its mode `[C]`:
- `[HighLogic]: =========================== Scene Change : From {FROM} to {TO} (Async) =====================` for a buffered switch;
- the same line without `(Async)` for a direct switch.

`[R]` On KSP-bench, where KSPCF is installed and `ForceSyncSceneSwitch` is
off, these switches were `(Async)`:
- MAINMENU→SPACECENTER;
- SPACECENTER→EDITOR;
- EDITOR→FLIGHT;
- FLIGHT→SPACECENTER;
- SPACECENTER→MAINMENU.

SPACECENTER↔TRACKSTATION and LOADING→MAINMENU were direct. KSP-dev, without
KSPCF, shows the same pattern. That pattern is the stock matrix.

**Robustness**
- This evidence shows the **effect**, whatever any setting or default says.
  A switch logged `(Async)` was buffered.
- A rule should look for KSPCF's patch for this mechanism by its class name,
  in the patch lines of this run. When that patch has no line (an older
  KSPCF, or a rename), the rule reports nothing about KSPCF.
- **The cost of a buffered switch is not measured on the same install.** It
  would need both modes. KSPCF pull request #250 reports 4 to 7 s per
  switch on a large modpack. That is an outside figure, and must be
  labeled so.

**Coverage**
- `kspcf-optimization-off` (M3) found `ForceSyncSceneSwitch` off through a
  one-entry table of KSPCF 1.41.1 defaults. That table was the debt to pay.
- **Mechanism-based replacement:** the finding is the effect, *N Holds used
  KSP's buffered scene switch*. It applies when KSPCF is installed and its
  patch for this mechanism logged that it was not applied. The reason comes
  from that line, and the candidates from 2.2.
- It needs no default: it reports what happened on this install.

**Player action:** a trade-off, not an error. The mod that turns it off
usually needs the buffered switch. The choice is between that mod and
faster Holds.

### 2.5 FastLoader

**What happens** `[C]`
- `KSPCFFastLoader` (`Performance/FastLoader.cs`, `Instantly`, KSP 1.12.3+,
  always on) takes over:
  - asset loading: audio, textures and models, in parallel, with an
    optional cache of PNG textures converted to DXT5;
  - part compilation (`PartLoader.StartLoad`).
- It kills the stock `GameDatabase.LoadObjects` coroutine by throwing from
  a prefix.
- It also reads every config file a second time, after `Instantly` addons
  have run.

Details belong to areas 3 and 4. What matters here:
- it cannot be turned off;
- its texture cache has a state;
- it writes its own timing report.

**What controls it**
- `PluginData/PNGTextureCache.cfg`: whether the texture cache is on. On
  the first run, a dialog asks and loading waits for the answer, which is
  not logged.
- The cache's validity per texture: file size and time.

**Evidence** `[C]`, `[R]`
- `[KSPCF] Injecting FastLoader...`, then `[KSPCF] Taking over stock
  loader. An exception will follow, this is intended.`
- An exception with the message `Terminating stock loader coroutine, this
  is intended and not an error`. **It is not an error,** and no rule may
  count it as one.
- **Per-asset lines** `Load {type}: {url}`:
  - texture types: `PNG texture`, `Cached PNG Texture`, `DDS texture`;
  - model types: `MU model`;
  - and so on.
  - Stock writes `Load(Texture): {url}` instead, so the line form shows
    whether FastLoader ran.
- **Texture cache state:**
  - cached: `Load Cached PNG Texture:`;
  - converted this startup: `Load PNG texture:` followed by `[KSPCF] PNG
    texture '{url}' was converted to DXT5 and has been cached for future
    reloads`;
  - not eligible: no conversion line, and a warning about the texture size.
- **A report at the main menu's `Start`:** `[KSPCF:FastLoader] {cpu} | ...`,
  then `Total loading time to main menu : {s}s` (since the Unity player
  started) and one line per phase. The phases are:
  - configs;
  - assets by type, with counts and sizes;
  - asset bundles;
  - `GameDatabase (configs, resources, traits, upgrades...)`;
  - part compilation and `PartIcon compilation`;
  - internals;
  - DLC;
  - the planetary system.
- **"GameDatabase ... loaded"** ends at `OnGameDatabaseLoaded`, before MM's
  post-patch stage. It does **not** include ModuleManager.

`[R]` KSP-bench:
- 1,883 `Load Cached PNG Texture:` lines and 429 `Load PNG texture:` lines;
- no conversion line, so the cache was warm;
- the report gives `11499 assets loaded in 21.944s`, `1879 parts and 18035
  modules compiled in 60.305s`, and `GameDatabase ... loaded in 0.630s`.

**Robustness**
- The report is free-form, and its DLC line is conditional. Parse it line
  by line with known prefixes, and leave unknown lines out.
- The report exists since 1.37.0 (PR #269), and the cached-texture lines since
  about 1.24 (`git grep` over the tags).
- The report's "main menu" is earlier than MM's and the profiler's. A frame
  that stalls the main menu after it is not in it.

**Coverage:** candidates for areas 3 and 4:
- a Countdown breakdown from the report;
- *texture cache off or rebuilt this startup*.

**Player action:** keep the texture cache on (KSPCF's settings, in the
game's settings screen).

### 2.6 Other KSPCF patches on the loading or switch path

All are keyed and on by default in 1.41.1 `[C]`. Their mechanisms belong to
other areas.

| Patch | What it changes | Log | Area |
|---|---|---|---|
| `PartParsingPerf` | `PartLoader.CreatePartIcon`, `ApplyPartValue` | FastLoader report's `PartIcon compilation` | 3 |
| `DragCubeGeneration` | drag-cube rendering | `[KSPCF/DragCubeGeneration] Creating drag cubes for part '{name}'` | 3 |
| `ExpansionBundlePreload` | DLC bundles load during part compilation | `ExpansionsLoader: Expansions loaded in {s}s` (same text as stock) | 4 |
| `LocalizerPerf`, `PersistentIConfigNode` | hot paths during loading | none | 4 |
| `SceneLoadSpeedBoost` | caches the save in memory between switches | `[SceneLoadSpeedBoost] Save loaded from cache in {ms}ms` / `from disk in {ms}ms`. The "disk" time accumulates over calls (the stopwatch is started, not restarted) and is unreliable | 6 |
| `MemoryLeaks` | cleanup when leaving a scene | `[KSPCF:MemoryLeaks] Leaving scene "{scene}", cleaned {n} memory leaks in {s}s. ...` | 6 |

### Area 2: how to know KSPCF's options and defaults without a table

| Question | From KSP.log, any KSPCF 1.10+ | With the T-Minus profiler |
|---|---|---|
| Which patches exist in this version | The class names in the per-patch lines | Same |
| Which are applied or off, and why | The per-patch lines (2.1) | Same |
| A key's default | **No** | Its value in the installed `Settings.cfg`, read from disk (a hand edit counts as the default) |
| Who changed a key | Candidates: MM's patch lines on the node (2.2) | The keys that differ, plus MM's patch lines |
| Does it cost loading time | Only where the mechanism's effect shows in the log: `(Async)` switches (2.4), texture cache lines (2.5) | Same, plus the profiler's timings |

Two parts are fixed knowledge: KSPCF's mechanism (one line per patch, the
key is the class name) and the KSP mechanism a patch acts on (for example
`SceneTransitionMatrix` and `ForceSyncSceneSwitch`). Both come from code.
Nothing depends on a version's defaults.

### Area 2: candidate rules for M5

| Candidate | Evidence | Level |
|---|---|---|
| KSPCF settings not read (duplicate `KSP_COMMUNITY_FIXES` node) | every keyed patch off in settings | log |
| KSPCF patching time | per-patch line timestamps inside MM's post-patch stage | log |
| KSPCF settings changed from the installed file | profiler: installed `Settings.cfg` against `SettingsNode`, written to KSP.log | profiler (summary format change) |
| Countdown breakdown from FastLoader's report; texture cache state | 2.5 | log (areas 3 and 4) |
| Never count `Terminating stock loader coroutine` as an error | 2.5 | log |

### Area 2: analyzer issues found

Both were fixed with this area (2026-10-15).

1. **`kspcf-optimization-off` matched one version's text.** KSPCF 1.10 to
   1.36 write `(disabled in Settings.cfg)`, where 1.37+ write `(not enabled
   in Settings.cfg)`. On those versions the rule found nothing.
   - `core/kspcf.ts` now parses the per-patch lines by their structure,
     for any KSPCF version from 1.10.
2. **`kspcf-optimization-off` depended on a table of KSPCF 1.41.1 defaults**
   (2.4).
   - The rule is replaced by `buffered-scene-switch`. It reports the effect
     seen on this install: `(Async)` switches while KSPCF's patch for this
     mechanism logged that it was not applied.
   - The reason comes from that line. MM's patches on the settings are
     candidates only when the reason is the settings.

---

## 3. PartLoader: part compilation

After the GameDatabase has loaded configs and assets (area 4) and MM has
patched them (area 1), `PartLoader` turns every `PART` config into a part
prefab, every `PROP` and `INTERNAL` config into IVA prefabs, and drag cubes
for parts that have none. On a modded install it is one of the largest
phases of the Countdown.

Sources: `PartLoader`, `DragCubeSystem`, `DragCubeList`, `Part`,
`PartModule`, `InternalModel`, `InternalProp`, `AvailablePart`,
`PartUpgradeHandler` in `Assembly-CSharp`; KSPCF 1.41.1
`Performance/FastLoader.cs`, `Performance/DragCubeGeneration.cs`,
`Performance/PartParsingPerf.cs`, `QoL/NoIVA.cs`.

### 3.1 The sequence, stock and with FastLoader

**What happens** `[C]`
1. `PartLoader.StartLoad` → `CompileAll` (a coroutine):
   - copies the 9 built-in parts (the EVA kerbals and the flag);
   - extracts the `PART`, `PROP`, `INTERNAL` and `VARIANTTHEME` configs;
   - reads `PartDatabase.cfg` (3.2) and compiles the variant themes;
   - runs `CompileParts`, then `CompileInternalProps` and
     `CompileInternalSpaces` (3.6);
   - writes `PartDatabase.cfg`, links part upgrades
     (`PartUpgradeHandler.LinkUpgrades`) and fires `OnPartLoaderLoaded`.
2. `CompileParts`, per `PART` config:
   - logs `Compiling Part` **before** any work on the part;
   - built-ins take a special branch: modules are loaded on the existing
     prefab, with no icon, drag cubes or module info;
   - every other part goes through `ParsePart`, then drag cubes (3.2) if the
     part has none, then `CompilePartInfo` (3.4) and `AddVariants`;
   - yields a frame when `LoadingScreen.minFrameTime` has passed.
3. `ParsePart` is synchronous. In order:
   - `CompileModel` instantiates the part's models (`MODEL{}` nodes, or the
     first model in the config's folder);
   - `CreatePart` adds the `Part` component (possibly a mod subclass) and
     calls its `OnLoad`;
   - root values, attach nodes, effects and sounds;
   - per `MODULE` node, `Part.AddModule`: `AddComponent` (constructor and
     field initializers, then `Awake`/`OnAwake`), then `PartModule.Load`
     (upgrades, fields, `OnLoad`);
   - `CreatePartIcon` (3.3), bounds, collider, auto tags.
4. **Mod code runs** in `CreatePart` (a `Part` subclass), in every module's
   constructor, `Awake`, `OnLoad`, `OnIconCreate` and `GetInfo`, and in
   `IMultipleDragCube` modules during drag cubes. A module's `Awake` runs
   on the prefab, again on the icon clone, and again on the drag-cube copy
   when the stock renderer makes one `[I]` (Unity runs `Awake` on
   `Instantiate` of an active object).

**FastLoader** replaces only the outer coroutine `[C]`:
- A transpiler on `PartLoader.StartLoad` swaps `CompileAll` for
  `KSPCFFastLoader.PartLoader_CompileAll`, which runs the same steps in the
  same order and calls the stock `CompileParts`, `CompileInternalProps`,
  `CompileInternalSpaces` and `SavePartDatabase`.
- Its `FrameUnlockedCoroutine` drives those enumerators by hand. It yields
  a real frame only after 1/30 s, or when a drag-cube position asks for one.
  Nested coroutines (drag cubes) run inline on a stack instead of through
  Unity's scheduler.
- So every per-part stock method and every per-part log line still happens
  once per part. What changes is the frame pacing, the exception handling
  (3.5), and the methods KSPCF's other patches replace (3.2, 3.3).

**What controls it**
- The content: the number of parts, modules per part, models, effects and
  variants. Mods add parts, and patches add modules to existing parts.
- The mods' module code, listed above.
- KSPCF: FastLoader (always on), `DragCubeGeneration`, `PartParsingPerf`
  and `NoIVA`.

**Evidence**
- `PartLoader: Compiling Part '{url}'`, one per `PART` config, built-ins
  included, written by `CompileParts` in both paths `[C]`. `{url}` is the
  config's GameData-relative URL; its first segment is the mod folder.
- No start or end line of its own. The phase runs from the first `Compiling
  Part` line to the line after the last `Compiling Internal Space`.
- FastLoader's report at the main menu `[C]`: `- {parts} parts and
  {modules} modules compiled in {s}s` (the whole `CompileParts` run,
  frames included), `  - {x} modules/part, {ms} ms/part, {ms} ms/module`,
  `  - PartIcon compilation : {s}s` (3.3), `- {spaces} internal spaces and
  {props} props compiled in {s}s`. `{parts}` counts the built-ins.
- `[R]` KSP-bench:
  - 1,907 `Compiling Part` lines, from 04:33:26.368 to the first `Compiling
    Internal Space`;
  - the report says `1879 parts and 18035 modules compiled in 60.305s`;
  - the sum of the gaps between consecutive `Compiling Part` lines (and the
    first internal line) is **60.304 s**, grouped by the URL's first
    segment it ranks mods in the same order as the profiler's
    `part.parse.byMod`.
  - 1,907 lines minus 22 failed parts (3.5) is 1,885, not 1,879. The six
    parts of difference are not explained here.

**Robustness**
- The `Compiling Part` line is stock and unchanged by FastLoader. KSP
  1.12.5 is the last version, so its text is fixed.
- A gap holds the previous part's work plus any frame and any other
  thread's log line between them. It is a per-part upper bound, exact in
  total only because the lines cover the whole loop.
- A part's URL names the folder of the config file that holds the `PART`
  node. Whether a part copied by an MM `+PART` patch is filed under the
  original's folder or the patching mod's is not checked `[I]`.

**Coverage**
- `part-parsing-by-mod` (M3) reports the profiler's `ParsePart` per mod.
  It misses drag cubes and module info (3.2, 3.4), and the Countdown
  breakdown has no part compilation line without the profiler.
- M5 candidates: part compilation per mod from the log gaps; the phase's
  total in the Countdown breakdown at the log-only level.

**Player action:** informational. Part count and module count are the
price of the content; a mod whose parts cost far more per part than others
can be reported to its author.

### 3.2 PartDatabase.cfg and drag cubes

**What happens** `[C]`
1. `InitializePartDatabase` reads `<KSP root>/PartDatabase.cfg`. A missing
   file, or a version different from the game's, starts an empty database.
2. Each part's record is a `PART` node keyed by URL, with `timestamps`
   (the binary file times of the part's `.cfg` and each model it uses;
   textures are not included) and the stored `DRAG_CUBE` node.
   - No record: one is created.
   - Timestamps differ: the record's children are cleared, so its drag
     cubes are dropped.
3. A part with `DRAG_CUBE { cube = ... }` in its config uses those cubes and
   only saves them to the database.
4. Any other part (including `procedural` and `none` in the config) goes
   through `DragCubeSystem.SetupDragCubeCoroutine`. It loads the cubes from
   the database record if it can; otherwise it renders them:
   - **stock** (`RenderDragCubesCoroutine`, `RenderDragCubes`): instantiate a
     copy of the part; for each `IMultipleDragCube` position
     (`AssumeDragCubePosition`, mod code), one frame plus 6 camera renders
     with a pixel readback; a module that asks for procedural cubes skips
     the render.
   - **KSPCF `DragCubeGeneration`** (1.28+, on by default since 1.31.1): transpilers
     on `SetupDragCubeCoroutine` redirect the render to KSPCF's own
     coroutine. Single-cube parts are rendered in place, without a copy and
     without a frame per cube; multi-cube parts use a copy and one frame per
     position. Cube values differ slightly from stock.
5. ModuleManager deletes `PartDatabase.cfg` on every startup that patches
   without its cache (1.4), so every drag cube is rendered again.

**What controls it**
- MM's cache state (1.2, 1.3): the main cause of a full regeneration.
- A changed `.cfg` or model file of a part: that part only, once.
- A game version change: the whole database, once.
- Mods: `IMultipleDragCube` positions (variants, deployables, jettisons)
  multiply the render cost; `DRAG_CUBE` nodes in a config skip it.

**Evidence** `[C]`
- `PartLoader: Creating part database`, or `PartLoader: Loading part
  database`, or `PartLoader: Version strings do not match. Creating part
  database.`
- Per part: `PartLoader: Part '{url}' has no database record. Creating.` or
  `PartLoader: Timestamps for part '{url}' do not match. Resetting.` These
  appear for parts with config-defined cubes too.
- Per render: `[DragCubeSystem]: Drag cubes not found or cannot be read for
  part {name}. Generating New drag cubes.`, then either `DragCubeSystem:
  Creating drag cubes for part '{name}'` (stock) or `[KSPCF/DragCubeGeneration]
  Creating drag cubes for part '{name}'`. Procedural parts log `... has
  defined a procedural drag cube setup` with the same two prefixes.
- `[R]` KSP-bench: `Creating part database`; 1,870 `has no database record`
  (1,907 parts minus the 9 built-ins and failed parts); 1,667 `Generating
  New drag cubes` = 1,650 `[KSPCF/DragCubeGeneration] Creating drag cubes`
  + 17 procedural; no `Resetting` line.
- `[R]` The profiler's hook on `SetupDragCubeCoroutine` MoveNext recorded
  3,334 steps (two per part) and 0.85 s. It does not hold the rendering: on
  stock the render runs in a nested coroutine's later steps, and with
  `DragCubeGeneration` in KSPCF's coroutine. The part compilation time no
  hook covers (60.3 s minus `ParsePart` 34.1 s and `CompilePartInfo`
  3.0 s, about 23 s) matches the `drag-cubes-regenerated` estimate of
  22.2 s.

**Robustness**
- Count the `Creating drag cubes for part` lines without the prefix: both
  writers use the same tail.
- `Resetting` lines mean a part changed since the last startup: expected
  once after an update, not a recurring cost.
- The link to MM is inferred (1.4).

**Coverage**
- `drag-cubes-regenerated` (M3) counts the lines and estimates an upper
  bound from the gap after each. The gap also holds that part's
  `CompilePartInfo` and any frame (about 2.6 s of the 22.2 s on KSP-bench,
  from the profiler).
- M5 candidates: tell "database recreated" (`Creating part database`,
  every part without a record) from "parts changed" (`Resetting`); with the
  profiler, subtract `CompilePartInfo` per part from the gap.
- Profiler (M5): measure drag cubes per part as the span from the first
  `SetupDragCubeCoroutine` step to its last, not the sum of its steps.

**Player action:** for a full regeneration, see 1.3 (MM's cache). After
installing or updating mods, one regeneration is expected.

### 3.3 Part icons

**What happens** `[C]`
- `PartLoader.CreatePartIcon`, once per non-built-in part, inside
  `ParsePart`: instantiates the whole part (so every module's `Awake` runs
  again `[I]`), calls `OnIconCreate` on each module, strips components and
  hidden renderers in one hierarchy scan per component type, and builds
  icon materials.
- KSPCF `PartParsingPerf` (1.37+) replaces the method body with one scan
  and cached shaders. It still instantiates the part and calls
  `OnIconCreate`. It also replaces `ApplyPartValue`, which then no longer
  writes the stock per-value debug lines.

**What controls it:** part hierarchy size, module count, the modules'
`Awake` and `OnIconCreate`, and whether `PartParsingPerf` is applied.

**Evidence**
- No log line per icon `[C]`.
- FastLoader's report `  - PartIcon compilation : {s}s` sums KSPCF's own
  stopwatch, which only runs when `PartParsingPerf` is applied; otherwise
  it reads `0.000s`. The line is absent before 1.37.
- `[R]` KSP-bench: report `6.012s`, profiler `CreatePartIcon` 6,017 ms over
  1,870 calls.

**Robustness:** a `0.000s` icon line means `PartParsingPerf` was not
applied, not that icons were free.

**Coverage:** inside `part-parsing-by-mod` (the profiler's `ParsePart`
includes it). Not a candidate of its own: the cost is per part, and the
action is the same as 3.1.

**Player action:** none beyond 3.1.

### 3.4 Module info (`GetInfo`)

**What happens** `[C]`
- `PartLoader.CompilePartInfo`, once per non-built-in part, after drag
  cubes: per module, `GetInfo`, `GetModuleTitle`, `GetPrimaryField`,
  `GetModuleDisplayName` (all mod code), plus upgrade text when the module
  has upgrades; then resource info and sorting.
- At the end of part compilation, `PartUpgradeHandler.LinkUpgrades` loops
  over every part, module and upgrade.

**What controls it:** the modules' `GetInfo` code and the number of modules.

**Evidence**
- No log line `[C]`.
- `[R]` KSP-bench: profiler `CompilePartInfo` 2,955 ms over 1,870 parts.

**Robustness:** `GetInfo` is not wrapped in a try/catch (3.5).

**Coverage:** the profiler's `partLoader.methods` table only; not in any
rule. M5 candidate: include it in the per-mod part cost (3.1 covers it
from the log gaps).

**Player action:** none beyond 3.1.

### 3.5 Errors during part compilation

**What happens** `[C]`
- `ParsePart` runs inside a try/catch. A part that throws or fails a check
  is dropped: it is missing from the game, and nothing retries it.
- `PartModule.Load` catches a module's `OnLoad` exception; the part stays.
- An exception outside `ParsePart` (for example in `GetInfo`):
  - stock: it escapes the coroutine; loading is expected to stop `[I]`;
  - FastLoader: logged with `Debug.LogException`; from a drag-cube
    coroutine the part continues; from `CompileParts` itself a "Loading
    failed" dialog names the part and loading stops.
- There is no duplicate-name check: both parts load, and name lookups get
  the first.

**What controls it:** broken or outdated part configs and models, often
after an MM patch or a mod update.

**Evidence** `[C]`
- Part dropped: `PartLoader: Encountered exception during compilation.
  {exception}` and/or `PartCompiler: Cannot compile part`, preceded by the
  specific cause (`PartCompiler: Cannot compile model`, `Model was not
  compiled correctly`, `Cannot clone model from '{dir}' directory as model
  does not exist`, `Cannot find Part of type '{module}'`, `Part config
  requires value 'name' is defined`, ...).
- Part kept: `PartCompiler: Cannot clone model '{model}' as model does not
  exist`, `Cannot replace texture ...`, `Module {name} threw during OnLoad:
  {exception}`, `Cannot find a PartModule of typename '{name}'`.
- The dropped part is the one in the last `Compiling Part` line before the
  error.
- `[R]` KSP-bench: 22 `Cannot compile part`, each right after `Cannot clone
  model`, `Model was not compiled correctly` and `Cannot compile
  model`; the other 21 `Cannot clone model` lines are on parts that load.

**Robustness:** the error lines are stock and fixed. Attribute each error
to the preceding `Compiling Part` line only when no other thread could have
written in between; part compilation runs on the main thread.

**Coverage:** none. M5 candidate: *parts dropped at load*, per mod folder,
naming the parts and the cause. It costs no time but explains missing parts
and points at the same broken configs as 1.3.

**Player action:** report the named parts to the mod; check the mod's
version against the game and its dependencies.

### 3.6 IVA: internal props and spaces

**What happens** `[C]`
- `CompileInternalProps` and `CompileInternalSpaces`, one per `PROP` and
  `INTERNAL` config: `CompileModel`, then the prop's or space's modules
  (`InternalModule`, mod code). A space instantiates every prop placed in
  it, so its cost scales with props per IVA.
- KSPCF `NoIVA` (off by default) disables IVA model and texture files at
  startup and retypes the `INTERNAL` and `PROP` configs, so they are not
  compiled.

**What controls it:** IVA mods, and `NoIVA` (`PluginData/NoIVA.cfg`).

**Evidence** `[C]`
- `PartLoader: Compiling Internal Prop '{url}'`, `PartLoader: Compiling
  Internal Space '{url}'`; failure lines `LoadInternalProp '{url}' FAILED:
  ...` and `LoadInternalPart '{url}' FAILED: ...`.
- `[KSPCF:NoIVA] {n} IVA models and {m} IVA textures pruned in {s}s`.
- FastLoader's report: `- {spaces} internal spaces and {props} props
  compiled in {s}s`.
- `[R]` KSP-bench: NoIVA on (483 models and 459 textures pruned in 1.875 s);
  16 spaces and 0 props, 0.056 s.

**Coverage:** small on KSP-bench, so no measurement of a full IVA set.
Covered by the per-mod log gaps (3.1) if they extend to internal lines.

**Player action:** NoIVA trades IVAs for loading time and memory; it is the
player's choice.

### Area 3: candidate rules for M5

| Candidate | Evidence | Level |
|---|---|---|
| Part compilation per mod (parts, drag cubes, module info) | gaps between `Compiling Part` lines, grouped by URL folder; heuristic per part, exact in total | log |
| Part compilation in the Countdown breakdown | first `Compiling Part` to after the last internal line; FastLoader's report when present | log |
| Drag cubes: database recreated vs parts changed | `Creating part database` / `has no database record` vs `Resetting` | log |
| Parts dropped at load | `Cannot compile part` and the cause, with the preceding `Compiling Part` | log |
| Drag cube estimate without module info | subtract the profiler's `CompilePartInfo` per part from each gap | profiler |
| Drag cubes measured per part | profiler change: span of `SetupDragCubeCoroutine`, not the sum of its steps | profiler (C#) |

### Area 3: analyzer issues found

1. **`drag-cubes-regenerated` showed the profiler's `SetupDragCubeCoroutine`
   steps as evidence** (0.85 s on KSP-bench, labeled "CPU steps only").
   The code shows the hook never holds the rendering (3.2), so the number
   did not measure drag cubes. Removed with this area (2026-10-15). The
   profiler's own fix is a candidate above.
2. **The 1,879 vs 1,885 part count** (3.1) is open. It does not affect any
   rule.

---

## 4. GameDatabase: configs and assets

`GameDatabase` is the first loading system. It loads the mod DLLs, starts the
`Instantly` addons, reads every config file and loads every audio clip,
texture and model under `GameData`. It ends when `OnGameDatabaseLoaded`
fires. ModuleManager patches in parallel on a worker thread (1.1).

Sources: `LoadingScreen`, `GameDatabase`, `UrlDir`, `ConfigNode`,
`DatabaseLoader*`, `PartReader` in `Assembly-CSharp`; KSPCF 1.41.1
`Performance/FastLoader.cs`, `Performance/ConfigNodePerf.cs`,
`Performance/GameDatabasePerf.cs`.

### 4.1 The sequence, and the first long frame

**What happens (stock)** `[C]`
1. `LoadingScreen.LoadSystems` starts each loading system in turn
   (`StartLoad`) and polls `IsReady` once per frame. At the end it logs
   `Loading Systems: Elapsed time is {s}s`.
2. `GameDatabase.StartLoad` → `CreateDatabase` → `LoadObjects`. Up to the
   first asset, all of this runs **in one frame, with no yield**:
   - a first `UrlDir` scan of GameData (it registers only DLLs, but parses
     every `.cfg` file anyway, 4.2);
   - every DLL is loaded (`Load(Assembly): {url}`) and the environment
     dump is written;
   - `AddonLoader.StartAddons(Instantly)`: every `Instantly` addon's
     `Awake` (area 5);
   - `SetupMainLoaders` collects the asset loaders, stock and mods' (4.5);
   - a **second full `UrlDir` scan**, which parses every config again, and
     `translateLoadedNodes`;
   - the start of the asset loops (4.3).
3. Audio, then textures, then models, file by file, yielding a frame when
   `LoadingScreen.minFrameTime` has passed.
4. `LoadAssetBundleObjects`, then the `Config(...)` loop (4.6), resources,
   traits and upgrades, `OnGameDatabaseLoaded`, and `GameDatabase: Assets
   loaded in {s}s`.

**With FastLoader** `[C]`
- KSPCF's `Instantly` addon `KSPCFFastLoader` puts a prefix on
  `GameDatabase.SetupMainLoaders`. The prefix starts KSPCF's own loader
  coroutine and then throws, which ends the stock `LoadObjects` (2.5).
- That coroutine runs synchronously up to its first yield: it does a
  **third** full `UrlDir` scan ("Configs reload"), because `Instantly`
  addons may have written configs or assets, then its own translation.
  The stock second scan and translation never run.
- Then it loads assets with its own scheduler (4.3) and lets the stock
  `CreateDatabase` continue.
- The `Instantly` addons' `Start` methods run at the start of the next
  frame, before its `Update` `[I]` (Unity order).

**What controls it**
- The number and size of config files (each parsed two or three times,
  4.2), DLLs, and the `Instantly` addons' `Awake` and `Start` (area 5).
- Whether KSPCF is installed (FastLoader cannot be turned off, 2.5).

**Evidence**
- Stock and KSPCF: `Load(Assembly): {url}`, `[AddonLoader]: Instantiating
  addon '{type}' from assembly '{asm}'`, `Compiling Configs:`, `GameDatabase:
  Assets loaded in {s}s` (from `LoadObjects` to the end), `Loading Systems:
  Elapsed time is {s}s` (all loading systems).
- FastLoader's report (2.5) splits the phase: `Configs and assemblies
  loaded in` (process start to KSPCF's `Awake`), `Configs reload done in`
  (the third scan only), `Configs translated in`, `{n} assets loaded in`
  with one line per type, `Asset bundles loaded in`, `GameDatabase (configs,
  resources, traits, upgrades...) loaded in` (from the asset bundles to
  `OnGameDatabaseLoaded`). The report exists since KSPCF 1.37.0.
- `[R]` KSP-bench, run `20261015-043911`:
  - log start 04:31:21.3; DLLs 04:31:28.3–28.5; `[KSPCF] Injecting
    FastLoader...` 04:31:31.5; `[KSPCF] Taking over stock loader` 04:31:45.1;
  - report: configs and assemblies 13.000 s, reload 10.887 s, translation
    0.085 s, assets 21.944 s;
  - profiler: `startup.preProfiler` 11.1 s (the profiler's own start),
    `gameDatabase.urlDir` **10.887 s** (the same scan as KSPCF's reload),
    `setupMainLoaders.threw` at t = 27.1 s, and the first observed frame at
    t = 33.7 s;
  - `GameDatabase: Assets loaded in 53.113s`; `Loading Systems: Elapsed time
    is 186.3665s`.

**Robustness**
- The stock lines are fixed (KSP 1.12.5 is final). The report lines depend
  on the KSPCF version; parse them by known prefixes (2.5).
- `Configs and assemblies` starts at process start, not at the log's
  first line.

**Coverage**
- The profiler's frame monitor starts measuring at its first `Update`.
  The frame that holds the `Instantly` addons, the config reload and the
  addons' `Start` (about 22 s on KSP-bench) has no previous timestamp, so
  it never becomes a `frame.long`. This is analyzer issue 5 of area 1,
  explained here; the fix is in the profiler (M5): start the frame clock at
  the profiler's `Awake`.
- M5 candidate: the Countdown breakdown at the log-only level, from these
  lines and FastLoader's report when present.

**Player action:** none of its own; the parts are 4.2 to 4.6.

### 4.2 Config scan and parse

**What happens** `[C]`
- `UrlDir` walks `GameData` (plus the legacy `parts` and `internals`
  roots). It skips only folders named exactly `.svn`, `PluginData` and
  `zDeprecated`, at any depth. `.git` and other folders are walked.
- Every file whose extension is exactly `cfg` is parsed on the spot with
  `ConfigNode.Load`; every other file becomes a `UrlFile` typed by an exact
  match of its extension against the loaders' lists. The match is
  case-sensitive: `part.CFG` is never parsed and `texture.PNG` is never
  loaded, in stock and with KSPCF.
- The stock parser reads all lines, strips comments, splits braces onto
  lines (one `List.Insert` each) and builds the tree. It never reports an
  unbalanced brace: an extra `}` drops the rest of the file, a missing one
  nests the following nodes.
- KSPCF `ConfigNodePerf` (an unconditional `Instantly` addon) replaces
  `ConfigNode.Load` with a faster parser and falls back to the stock one on
  an exception. The first scan runs before any addon, so it always uses the
  stock parser; the reload uses KSPCF's.
- Parses per startup: two in stock, three with KSPCF (and MM works on the
  result, area 1).

**What controls it:** total config size and file count, across all mods.

**Evidence**
- No per-file line. `Config in file '{path}' contains an unnamed node.
  Skipping.`, `Config in file '{path}' contains no data.`, `Error: Empty
  part config file` and `[KSPCommunityFixes] ConfigNodePerf: Exception
  reading file {path}, using fallback ConfigNode reader.` mark problem
  files.
- Time: `gameDatabase.urlDir` (profiler) and FastLoader's `Configs reload
  done in`, both for one scan.
- `[R]` KSP-bench: 18,650 `Config(` lines (4.6); 2 unnamed-node and 21
  no-data warnings; 10.887 s for one scan.

**Robustness:** a scan's time is wall time on the main thread; MM's worker
thread is not running yet during the first two scans.

**Coverage:** none. M5 candidate: *config parse cost*, from
`gameDatabase.urlDir` or the reload line, with the number of parses per
startup stated. The action is general (fewer, smaller configs), so it is
informational unless the time is large; no per-mod split is possible from
the log.

**Player action:** informational. Each `.cfg` is parsed two or three times
per startup; large config sets cost proportionally.

### 4.3 Assets: audio, textures, models

**What happens, stock** `[C]`
- One file at a time, on the main thread, in `UrlDir` order: `Load(Audio):
  {url}`, `Load(Texture): {url}` or `Load(Model): {url}`, then each loader
  whose extensions match.
- PNG and JPG load through `UnityWebRequestTexture`; normal maps (name
  ending in `NRM`) are converted with a per-pixel managed loop; textures
  whose sides are multiples of 4 are DXT-compressed on the main thread; the
  result stays readable (a CPU copy in memory). DDS, TGA, MBM and MU are
  read synchronously. Audio loads one request at a time.

**What happens, FastLoader** `[C]`
- Audio: up to 25 requests at once. `Load Audio: {url}` is logged when a
  request **starts**.
- Textures and models: a reader thread reads files ahead (about 50 MB or
  10 files); the main thread takes them in list order, logs `Load
  {TypeName}: {url}` **right before** decoding that file, then decodes and
  uploads it. Decode, compression, normal-map conversion and MU parsing
  (KSPCF's own parser since 1.37) stay on the main thread.
- Type names: `DDS texture`, `PNG texture`, `Cached PNG Texture`, `JPG
  texture`, `TGA texture`, `MBM texture`, `TRUECOLOR texture`, `MU model`,
  `DAE model`. Files for mods' loaders log `Load Texture:` / `Load Model:`
  / `Load Audio:` (4.5).
- A frame is yielded about every 1/30 s.

**What controls it:** the number and size of textures (PNG vs DDS, normal
maps, sizes that are not multiples of 4), audio and models.

**Evidence**
- Per-file lines as above. A failure or warning line for a file follows
  its own `Load` line (4.7).
- FastLoader's report: per type, count, size, time and throughput.
- `[R]` KSP-bench: 4,327 DDS, 1,883 cached PNG, 429 PNG, 56 TRUECOLOR, 10
  TGA, 4 MBM, 1 JPG, 3,368 MU, 1,392 audio. Report: audio 10.068 s,
  textures 6.245 s, models 5.626 s, in that order in the log
  (04:31:52–04:32:02, 04:32:02–04:32:08, 04:32:08–04:32:14).
- `[R]` The gap from each texture or model line to the next line sums to
  5.956 s for textures and 5.274 s for models, about 95 % of the report's
  times. Grouped by the URL's first segment it ranks folders by main-thread
  cost (KSP-bench: ReStock 1.07 s, KerbinSideRemastered 0.93 s, ...).

**Robustness**
- Texture and model gaps measure main-thread decode and upload, plus a
  yielded frame now and then and any wait for the reader thread. Disk
  reading is mostly hidden by the thread. They are a per-folder upper
  bound, close in total.
- Audio lines mark request starts, with 25 in flight: per-file or
  per-folder audio time **cannot** be read from the log. Only the report's
  total is usable.
- In stock, each gap holds the whole load of one file, including frames.

**Coverage:** none. M5 candidates: *asset loading per mod* (textures and
models, from the gaps, heuristic); *asset totals by type* from the report
or, in stock, from the first line of each type.

**Player action:** informational per mod. A mod whose textures dominate can
be reported (e.g. PNG where DDS would do). Large audio packs cost their
size.

### 4.4 KSPCF's PNG texture cache

**What happens** `[C]`
- With the cache on, a PNG that ends up DXT5 (normal maps, or sides that
  are multiples of 4) is stored as raw texture data in
  `KSPCommunityFixes/PluginData/TextureCache/` with an index
  (`textureData.json`).
- On the next startup a cached PNG is read from the cache, skipping decode
  and compression. An entry is dropped when the PNG's size or time changes;
  the whole cache is wiped after a crash during loading (a `progressMarker`
  file left behind) or a format change, and deleted when the cache is off.
- On the first run a dialog asks whether to enable it; loading waits for
  the answer.

**What controls it:** `PluginData/PNGTextureCache.cfg`
(`textureCacheEnabled`), and KSPCF's settings screen.

**Evidence** `[C]`
- Hit: `Load Cached PNG Texture: {url}`.
- Miss, then stored: `Load PNG texture: {url}` followed by `[KSPCF] PNG
  texture '{url}' was converted to DXT5 and has been cached for future
  reloads`.
- Not eligible: `Load PNG texture:` followed by `Texture isn't eligible for
  DXT compression, width and height must be multiples of 4`.
- `[KSPCF] Failed to load cached PNG texture '{url}'`, `... couldn't be
  cached : IO error`.
- Cache off: `Load PNG texture:` lines with neither a conversion line nor a
  cached line anywhere.
- `[R]` KSP-bench: 1,883 hits, 429 `Load PNG texture:`, 427 not-eligible
  warnings, no conversion line: the cache was warm, and the PNGs it cannot
  take are the ones with sizes that are not multiples of 4.

**Robustness:** the lines exist since KSPCF 1.24 (2.5). The not-eligible
warning carries no URL; it belongs to the `Load` line just before it.

**Coverage:** M5 candidates: *texture cache off* (PNG loads and no cached
or conversion line); *cache rebuilt this startup* (many conversion lines;
expected once after installing mods, a problem if every startup).

**Player action:** keep the cache on. If it is rebuilt every startup,
check whether loading is crashing (the cache is wiped after an unfinished
load).

### 4.5 Mods' own asset loaders

**What happens** `[C]`
- `SetupMainLoaders` instantiates every `DatabaseLoader<AudioClip>`,
  `DatabaseLoader<TextureInfo>` and `DatabaseLoader<GameObject>` subclass
  from every loaded assembly; their file extensions come from
  `DatabaseLoaderAttrib`. No log line names them.
- FastLoader keeps the stock extensions for itself and sends files with
  other extensions to mods' loaders, one at a time on the main thread,
  before its own pass of that type.

**Evidence:** `Load Texture: {url}`, `Load Model: {url}`, `Load Audio:
{url}` (FastLoader, for mods' loaders) or the stock `Load(...)` lines; the
file extension in the URL is not shown, so the loader is not named.

**Coverage:** the gaps after these lines are the mod loader's time. M5:
part of *asset loading per mod*.

**Player action:** report to the mod if large.

### 4.6 Compiling configs and the end of the GameDatabase

**What happens** `[C]`
- After the assets and asset bundles: `Compiling Configs:`, one `Config({TYPE})
  {url}` line per top-level config node, `Compiling Configs Completed.`,
  then resource and physics-material definitions, traits, part upgrades,
  `OnGameDatabaseLoaded` (MM's post-patch loader follows, 1.5).

**Evidence:** `[R]` KSP-bench: 18,650 `Config(` lines in 0.6 s
(04:32:14.404–14.995); FastLoader's `GameDatabase (...) loaded in 0.630s`.

**Coverage:** small, no candidate.

### 4.7 Asset errors and duplicates

**What happens** `[C]`
- Duplicate URLs (the same path with two extensions, e.g. `a.png` and
  `a.dds`): stock loads both and keeps the last (`Load(Texture): {url} OUT
  OF DATE`); FastLoader keeps the first and logs `Duplicate {TypeName}
  '{url}' with extension '{ext}' won't be loaded`.
- A file FastLoader cannot load logs `LOAD FAILED : {message}` after its
  `Load` line; there is no fallback to the stock loader. Stock logs
  `Texture load error in '{path}'`, `Model load error in '{path}'`, `Audio
  file: {name} load error: {error}`.
- A model whose texture is missing logs `Texture '{url}' not found!`.

**Evidence** `[R]` KSP-bench: 29 duplicates, 5 `LOAD FAILED`, 1,178
`not found!` lines.

**Robustness:** these cost little time each; a duplicate is still read
from disk.

**Coverage:** not a loading-time finding. A missing texture or a failed
file is a content problem, not a cost. No candidate; T-Minus stays on
loading time.

**Player action:** none from T-Minus.

### Area 4: candidate rules for M5

| Candidate | Evidence | Level |
|---|---|---|
| Countdown breakdown at the log-only level: DLLs, `Instantly` addons, config parse, assets by type, configs, part compilation | stock lines; FastLoader's report when present (4.1) | log |
| Asset loading per mod (textures, models, mods' loaders) | gaps after `Load {type}:` lines, by URL folder; heuristic, close in total (4.3) | log |
| PNG texture cache off, or rebuilt this startup | `Load PNG texture:` without cached or conversion lines; many conversion lines (4.4) | log |
| Config parse cost, with the number of parses | `gameDatabase.urlDir` or `Configs reload done in` (4.2) | log, profiler |
| The first loading frame as a long frame | profiler change: start the frame clock at `Awake` (4.1) | profiler (C#) |

### Area 4: analyzer and profiler issues

1. **Area 1's issue 5 (the first long frame)** is explained in 4.1: the
   frame monitor has no earlier timestamp for its first frame. The fix is a
   profiler change, left to M5, where it can be validated in game.
2. **Area 2 dated FastLoader's report "about 1.38".** It was added in
   1.37.0 (KSPCF PR #269); corrected in 2.5.

---

## 5. Assemblies and addons

How mod code gets into the game: KSP loads the mod DLLs, then creates the
mods' `KSPAddon` classes at fixed points of startup and of each scene load.
The addons' `Awake` and `Start` are where most mod startup work runs.

Sources: `AssemblyLoader`, `AddonLoader`, `GameDatabase`,
`VesselModuleManager`, `LoadingScreen`, `KSPLog` in `Assembly-CSharp`;
KSPCF 1.41.1 `Modding/ReflectionTypeLoadExceptionHandler.cs`.

### 5.1 Loading the mod DLLs

**What happens** `[C]`
1. In `GameDatabase.LoadObjects`, inside the first long frame (4.1):
   - `AssemblyLoader.LoadPluginInfo` records every DLL under GameData
     (`PluginData` folders are not scanned, 4.2);
   - per DLL, `Load(Assembly): {url}`, then `AssemblyLoader.LoadPlugin`
     reads the file and parses it twice with Mono.Cecil, to check type
     references and to read the `KSPAssembly` and `KSPAssemblyDependency`
     attributes. The DLL is not loaded into the runtime yet.
2. `AssemblyLoader.LoadAssemblies` sorts the DLLs by their declared
   dependencies, drops those whose dependencies are not met (5.2), and per
   DLL calls `Assembly.LoadFrom` and `GetTypes` once, to index part
   modules, scenario modules and the other KSP base types.
3. `VesselModuleManager.CompileModules` creates each `VesselModule` type
   once on a throwaway object, so mods' `OnAwake` runs here.
4. Then the environment dump, with `Mod DLLs found:` (the DLLs that
   loaded).

**Duplicates** `[C]`: a DLL with the same file name as one already loaded
(e.g. two copies of a shared library in different folders) is skipped
**silently**: the first one in folder order wins, whatever its version. The
version comparison in the code is never reached. Different file names (e.g.
`ModuleManager.4.2.2.dll` and `ModuleManager.4.2.3.dll`) both load; MM
resolves its own case with an "election".

**What controls it:** the number and size of DLLs.

**Evidence** `[C]`
- `Load(Assembly): {url}`, `AssemblyLoader: Loading assembly at {path}`,
  `AssemblyLoader: KSPAssembly '{name}' V{x.y.z}`, `AssemblyLoader:
  KSPAssemblyDependency '{name}' V{x.y.z}`, `AssemblyLoader: Loading
  assemblies`, `VesselModules: Found {n} VesselModule types`, the
  `Mod DLLs found:` list.
- No line per `LoadFrom` or `GetTypes`.
- `[R]` KSP-bench: 179 `Load(Assembly)` lines from 04:31:28.262 to 28.502;
  the first addon is created at 28.892. No duplicate file names.

**Robustness:** all stock strings, fixed. Comparing the `Load(Assembly)`
list with `Mod DLLs found:` shows which DLLs did not load, but not why
without the lines of 5.2.

**Coverage:** under 1 s on KSP-bench with 179 DLLs; no candidate for time.

**Player action:** none.

### 5.2 Missing dependencies and types that fail to load

**What happens** `[C]`
- **Declared dependency missing or too old** (`KSPAssemblyDependency`):
  the DLL is never loaded and costs nothing afterwards. Mods use this on
  purpose for optional integrations `[I]`.
- **Undeclared dependency missing:** the DLL loads, but `GetTypes` throws a
  `ReflectionTypeLoadException`; stock logs it and drops the DLL from its
  list. The DLL stays in memory but none of its addons or modules exist.
- **`ADDON BINDER`** (`AssemblyLoader.MyResolveEventHandler`): when the
  runtime cannot bind a reference, KSP tries to load an assembly by simple
  name; each name is tried and logged at most once.
- **KSPCF `ReflectionTypeLoadExceptionHandler`** (an `Instantly` addon,
  always on, since 1.13): replaces `Assembly.GetTypes` so that a failed
  type load returns the types that did load instead of throwing, and logs
  which plugin failed and which dependencies it misses. It is installed
  after stock `LoadAssemblies`, so stock has already dropped the DLL; its
  `Start` scans every assembly once more and reports it.

**Evidence** `[C]`
- `AssemblyLoader: Assembly '{name}' has not met dependency '{dep}'
  V{x.y.z}` and `... is missing {n} dependencies` (warnings).
- `AssemblyLoader: Exception loading '{name}': {exception}`, with the
  loader exceptions.
- `ADDON BINDER: Create binding redirect: ...`, `ADDON BINDER: Ingoring
  binding redirect due to incompatible versions: ...` (stock typo), `ADDON
  BINDER: Cannot resolve assembly: {name}`.
- `[KSPCF] A ReflectionTypeLoadException thrown by Assembly.GetTypes() has
  been handled by KSP Community Fixes.` with the plugin and its missing
  dependencies; the loader exceptions are listed since 1.41.0.
- `[R]` KSP-bench: one unmet dependency (`Kopernicus.KSCScatterMask.BurstPQS`
  needs `BurstPQS`, an optional integration); 24 `ADDON BINDER: Cannot
  resolve assembly` lines, mostly for mods' Unity UI assemblies; no
  `Exception loading` line.

**Robustness:** an unmet declared dependency is usually intended. An
`ADDON BINDER` line alone is not a failure.

**Coverage:** not a loading-time problem: a DLL that fails costs almost
nothing, it is just missing. No candidate. A missing mod is a content
problem, outside T-Minus.

**Player action:** none from T-Minus.

### 5.3 AddonLoader: when addons are created

**What happens** `[C]`
- `AddonLoader.StartAddons(level)` scans **every type of every loaded
  DLL** on each call (no cache), and for each `MonoBehaviour` with a
  `KSPAddon` attribute matching the level calls `StartAddon`. That logs
  `[AddonLoader]: Instantiating addon '{type}' from assembly '{asm}'`, then
  creates the object with `AddComponent`, so the addon's `Awake` runs
  **right after its line**, before the next one. `once` addons are created
  only the first time.
- When it runs:
  - `Instantly`: once, in `GameDatabase.LoadObjects` (the first long
    frame, 4.1);
  - every other level: on Unity's `sceneLoaded` for that scene
    (`PSystemSpawn`, `MainMenu`, `SpaceCentre`, `EditorAny`, `Flight`,
    `TrackingStation`, ...);
  - `EveryScene`: on every call, including the loading buffer scene.
- **Each Hold calls it twice:** `HighLogic.LoadScene` loads the
  `loadingBuffer` scene, then the target scene, and each fires
  `sceneLoaded`.
- Order inside a call: DLLs in their sorted order (5.1), types in
  declaration order.
- An exception in `Awake` is logged by Unity (`[EXC ...]` with the stack);
  creation continues with the next addon.

**What controls it:** the mods' addons and what their `Awake` does.

**Evidence**
- The `Instantiating addon` lines, in batches, one batch per call.
- The profiler: `addons.startAll` per call (label: the level, or
  `unityScene{n}` for scenes without a level, e.g. 1 = the loading
  buffer), and `addon.awake` per addon.
- `[R]` KSP-bench: 956 `Instantiating addon` lines. The time from one
  addon's line to the **next addon's line** reproduces the profiler's
  `addon.awake` within a millisecond inside a batch (Kopernicus `Injector`
  4,536 ms, RocketSoundEnhancement `Startup` 1,452 ms, DistantObject
  `Startup` 1,307 ms). The time to the next line of any kind does not:
  an addon that logs during `Awake` splits its own time (Injector shows
  1 ms).
- `[R]` The **last addon of each batch** has no end in the log: the time
  to the next addon line spans whatever follows the batch (Deferred's
  `ShaderLoader`, last in the `Instantly` batch, gets 177 s; the
  profiler measures 0.8 ms).
- `[R]` A call that creates few addons costs 34–48 ms (`unityScene1`):
  that is about the cost of the type scan itself, twice per Hold.

**Robustness**
- A log-only rule must cut at the next `Instantiating addon` line, and must
  find where each batch ends. The batch boundary is not logged. Candidates:
  the scene change lines around the batch, and the DLL order (inside a
  batch, the assembly order from `Mod DLLs found:` never goes back). The
  last addon of a batch stays unmeasured from the log alone, and the rule
  must leave it out rather than guess.
- The time also holds the type scan up to the next addon (small, as
  above).

**Coverage**
- `expensive-addon` (M3), from the profiler's `addon.awake` (and the
  summary). `long-stall-by-mod` (log level) is about Holds' stalls, not
  per-addon.
- M5 candidate: *expensive addon at the log-only level*, from the cut
  above, leaving out each batch's last addon. Confidence heuristic.

**Player action:** as `expensive-addon`: report to the mod; decide whether
the mod is worth its cost.

### 5.4 Addons' `Start`, and later work

**What happens** `[C]`/`[I]`
- An addon's `Start` runs at the start of the next frame, before its first
  `Update` (Unity order). For `Instantly` addons that is the frame after
  the first long frame (4.1).
- Nothing is logged between `Start` calls; a mod's own lines are the only
  marks.
- The profiler times `Start` per addon in diagnostic mode only
  (`addon.start`, lazy, opt-in), because hooking a mod's methods is only
  safe after the type exists (CLAUDE.md).

**Evidence:** `[R]` KSP-bench, diagnostic run `20261015-041352`:
ProgressiveCBMaps `VisualMaps` `Start` about 41 s (the bench
expectations check it).

**Coverage:** `expensive-addon` (`Start`, diagnostic mode). From the log,
a `Start` is only visible as a long gap next to a mod's lines
(`long-stall-by-mod`, heuristic).

**Player action:** as 5.3.

### 5.5 Other entry points for mod code

- **VesselModules**: mods' `OnAwake` once at startup (5.1).
- **Part modules**: during part compilation (3.1).
- **Scenario modules**: created per scene from the save (area 6).
- **GameEvents** handlers (`OnGameDatabaseLoaded`, `OnPartLoaderLoaded`,
  `onLevelWasLoaded`, `onGameStateLoad`, ...): mods subscribe and run
  inside the event's `Fire`. The profiler times each `Fire` by event
  (`gameEvent.fire`). The event `onLevelWasLoaded` fires one frame after
  the scene's addons `[C]`.
- **ModuleManager callbacks** (`ModuleManagerPostLoad`, post-patch
  callbacks): area 1.5.
- **Custom loading systems**: `LoadingScreen.loaders` is a public list,
  and `LoadSystems` reads its length each iteration, so a mod can insert
  its own loader (MM does, 1.1). Stock logs nothing per loader `[C]`; the
  profiler marks each loader's start and end.
- **Planetary system** (`PSystemSpawn` addons, e.g. Kopernicus): run after
  `PSystemManager.Awake` and before its `Start` `[C]`/`[I]`. FastLoader's
  report times the planetary system (2.5).

**Coverage:** the profiler covers events and loaders; a mod's work inside
them is attributed by `gameEvent.fire` key or by long frames.

### 5.6 Exceptions every frame

**What happens** `[C]`: each `[EXC]` line is written with its stack trace;
stock does not deduplicate. An addon that throws in `Update` writes one
per frame.

**Evidence:** `[R]` KSP-bench: 62 `[EXC` lines in the whole session, the
most repeated 21 times: no per-frame spam.

**Coverage:** none, and no candidate: the cost is per frame, not loading
time, and KSP-bench shows no case to check one against.

### Area 5: candidate rules for M5

| Candidate | Evidence | Level |
|---|---|---|
| Expensive addon `Awake` at the log-only level | time from an `Instantiating addon` line to the next one in the same batch; batch ends found from scene lines and DLL order; each batch's last addon left out (5.3) | log |
| DLL loading and `Instantly` addons in the Countdown breakdown | `Load(Assembly)` lines, the `Instantly` batch (4.1, 5.1) | log |

### Area 5: analyzer issues

None found. The existing rules read addon costs from the profiler, which
measures each `Awake` directly.

---

## 6. Holds: scene transitions

A Hold runs from the scene request to the moment the player can use the
new scene. KSP has no event or log line for that moment; it is when the
loading overlay (`LoadingBufferMask`) hides.

Sources: `HighLogic`, `SceneTransitionMatrix`, `LoadingBufferMask`,
`GamePersistence`, `Game`, `ScenarioRunner`, `FlightState`, `ProtoVessel`,
`FlightDriver`, `FlightGlobals`, `OrbitPhysicsManager`, `PSystemSetup`,
`PQS`, `SpaceCenterMain`, `EditorDriver`, `EditorLogic`, `SpaceTracking`,
`MainMenu` in `Assembly-CSharp`; KSPCF 1.41.1
`Performance/ForceSyncSceneSwitch.cs`, `Performance/SceneLoadSpeedBoost.cs`,
`Performance/MemoryLeaks.cs`; Unity's own lines in `Player.log`.

### 6.1 The common sequence

**What happens** `[C]`
1. **Before the request**, the caller usually saves (`GamePersistence.SaveGame`):
   leaving the space center for a building, leaving flight, launching. From
   the main menu, the whole save load (read, upgrade pipeline, `new Game`,
   a scan of every type for scenario modules, a save) runs before the
   request.
2. **`HighLogic.LoadScene`**: fires `onGameSceneLoadRequested` (stock
   handlers destroy every ScenarioModule, so mods' `OnDestroy` runs here;
   the overlay shows), fires `onGameSceneSwitchRequested`, logs the
   **Scene Change** line, and loads the scene: sync, or buffered (6.2).
3. **Scene loaded** (Unity's `sceneLoaded`): the addons of that scene
   (5.3), `PSystemSetup` (PQS on or off, 6.4), the overlay's logic. Then
   each scene object's `Start`, before its first `Update`.
4. **One frame later**: `onLevelWasLoaded`, then `onLevelWasLoadedGUIReady`
   (logged by `ApplicationLauncher`), then the mods' toolbar buttons.
5. **The overlay hides** (`LoadingBufferMask.Hide`, no log line):
   - flight: after at least 75 frames, and once the active vessel is loaded
     and unpacked (up to 400 frames); earlier if the vessel is not landed;
   - space center, buffered: 75 frames, then a fixed `WaitForSeconds(2)`;
   - editor, buffered: 75 frames;
   - space center or editor, sync, and every other scene: at scene load.

**Scene entry reloads the save** `[C]`: `SpaceCenterMain.Start`,
`EditorDriver.Start`, `FlightDriver.Start` and `SpaceTracking.Start` each
call `GamePersistence.LoadGame("persistent")` and `Game.Load`: every
ScenarioModule's `OnLoad` for that scene (6.3) and, where the scene has a
planetarium (space center, tracking station, flight), a `Vessel` object
for every vessel in the save.

**Evidence** `[C]`
- Start: `[HighLogic]: ... Scene Change : From {A} to {B} ...`, with
  ` (Async)` when buffered. Saves just before it: `Game State Saved to
  saves/{folder}/persistent`, after `Flight State Captured` when leaving a
  scene with vessels.
- `[ApplicationLauncher] OnSceneLoadedGUIReady: scene {B} ...`: one frame
  after the scene loaded, in every scene.
- KSPCF: `[KSPCF:MemoryLeaks] Leaving scene "{scene}", cleaned {n} memory
  leaks in {s}s. ...` when the old scene unloads.
- `[R]` KSP-bench: seven Holds; a save (from `Flight State Captured` to
  `Game State Saved`) takes 40–60 ms.

**Robustness**
- The profiler starts a Hold at `HighLogic.LoadScene`, so the save before
  it is outside the Hold. From the main menu the work before the request
  includes the player's click in the load dialog, so it cannot be timed
  from the log either.
- The overlay end has no log line. The log-only analyzer uses
  `[UIMasterController]: ShowUI` (written by `Hide`) for space center and
  flight (M3).

**Coverage:** the profiler's `scene.transition` per Hold, with markers;
long frames inside a Hold (`long-stall-by-mod`).

### 6.2 Buffered and sync switches

**What happens** `[C]`
- `SceneTransitionMatrix.GetTransitionValue(from, to)` decides; its values
  are scene data, not code. On KSP-bench, with KSPCF's direct switch off,
  the switches between the space center and the tracking station are sync
  and the others buffered.
- **Sync:** `SceneManager.LoadScene(target)`.
- **Buffered** (`HighLogic.bufferedLoad`): load the empty `loadingBuffer`
  scene, `Resources.UnloadUnusedAssets()`, `GC.Collect()`, then
  `LoadSceneAsync(target)` with activation held until 90 %, then activate.
  The overlay then adds its fixed waits (6.1).
- Unity unloads unused assets on every single-scene load `[I]`, so a
  buffered switch runs **three** asset cleanups (loading buffer, explicit,
  target) where a sync switch runs **one**. Each cleanup walks every live
  object, so its cost grows with everything the install keeps loaded.
- **KSPCF `ForceSyncSceneSwitch`** (on by default, 1.36+) makes
  `GetTransitionValue` return false: every switch is sync, and the overlay
  hides at scene load for the space center and the editor (flight still
  waits for its vessel). Area 2.4: mods can turn it off through KSPCF's
  settings (UniversalStorage2 does).

**What controls it:** KSPCF's `ForceSyncSceneSwitch` (and what turns it
off); the number of live objects (parts, textures, models: the whole
install).

**Evidence**
- KSP.log: ` (Async)` on the Scene Change line; the KSPCF patch line (2.4).
- **Player.log** (Unity, not in KSP.log) writes each cleanup with its time
  `[C]`/`[R]`: `Unloading {n} unused Assets to reduce memory usage. Loaded
  Objects now: {m}.` followed by `Total: {ms} ms (FindLiveObjects: ...
  MarkObjects: ... DeleteObjects: ...)`.
- Profiler: `scene.bufferedLoad.step` spans; the markers `guiReady` and
  `LoadingBufferMask.Hide`.
- `[R]` KSP-bench, run `20261015-043911` (Player.log):

  | Hold | Cleanups | Time |
  |---|---|---|
  | MAINMENU → SPACECENTER (Async) | 3 | 2.92 s |
  | SPACECENTER → EDITOR (Async) | 3 | 2.91 s |
  | EDITOR → FLIGHT (Async) | 4 | 4.27 s |
  | FLIGHT → SPACECENTER (Async) | 3 | 3.18 s |
  | SPACECENTER → TRACKSTATION | 1 | 1.11 s |
  | TRACKSTATION → SPACECENTER | 1 | 1.07 s |

  In each buffered Hold one cleanup frees **0 assets** and still takes
  about 1 s (760,000 live objects). The `GC.Collect` step takes 0.38–0.46 s
  (profiler). The space center's fixed overlay wait, from `guiReady` to
  `Hide`, is 3.5 s and 2.9 s.
- Together: about 2 s of extra cleanups, 0.4 s of collection and, for the
  space center, about 3 s of overlay per buffered Hold. KSPCF's PR #250
  reports 4–7 s per switch.

**Robustness**
- The cleanup lines are Unity's own, stable for Unity 2019.4, and only in
  Player.log.
- Which cleanup is which is not logged; the count per Hold and their sum
  are enough.

**Coverage**
- `buffered-scene-switch` (M3) reports the switches and the reason, with
  the cost not measured.
- M5 candidate: a measured cost for it, from the profiler (the
  `bufferedLoad` steps and the overlay wait from `guiReady` to `Hide`).
- **Player.log is not an analyzer input** (decided 2026-10-15). It adds
  only Unity's cleanup times, which serve this one rule; the profiler
  already measures the switch's cost. Against it: no timestamps on any
  line, one file shared by every KSP install on the machine (with only the
  previous run kept as `Player-prev.log`), and another input level to
  maintain. The cleanup numbers above stay as evidence for the mechanism.

**Player action:** as `buffered-scene-switch`: keep KSPCF's direct switch
on, or accept its cost for the mod that turns it off.

### 6.3 Save, ScenarioModules and vessels

**What happens** `[C]`
- Each scene entry reads `persistent.sfs` (`ConfigNode.Load`), builds the
  `Game` and a `ProtoVessel` for every vessel, and loads the scene's
  ScenarioModules (`ProtoScenarioModule.Load` → `OnLoad`, mod code). In
  scenes with a planetarium every vessel also gets its `Vessel` object and
  `VesselModule`s, and `onVesselCreate` fires per vessel. Parts are only
  created for loaded vessels (flight, 6.4).
- Every request destroys the ScenarioModules (`OnDestroy`), and every save
  calls their `OnSave`.
- **KSPCF `SceneLoadSpeedBoost`** (on by default) keeps the last saved
  `persistent` node in memory and reuses it on the next load, skipping
  only the file read and parse. On the main menu → space center Hold the
  cache cannot hit: the main menu saves before setting the save folder.

**What controls it:** save size and vessel count; mods' ScenarioModules
(`OnLoad`, `OnSave`, `OnDestroy`) and `VesselModule`s; `GameEvents`
handlers on `onGameStateLoad`, `onGameStateSave`, `onVesselCreate`.

**Evidence**
- `[SceneLoadSpeedBoost] Save loaded from cache in {ms}ms` / `... from
  disk in {ms}ms` (2.6).
- `[ScenarioUpgradeableFacilities]: Loading... {n} objects registered`
  marks the scenario load in each scene.
- `Exception loading ScenarioModule {name}: {exception}`.
- Profiler: `scenario.load` per module (`ScenarioRunner.AddModule`),
  `gameEvent.fire` per event.
- `[R]` KSP-bench: `from disk in 4ms` on main menu → space center, `from
  cache in 1–2ms` after (a small save).

**Robustness:** the save's size and vessel count are not logged.

**Coverage:** the profiler's `scenario.load` is in the report's tables but
not in a rule. M5 candidate: *expensive ScenarioModule* (per module, per
Hold), like `expensive-addon`.

**Player action:** report a costly ScenarioModule to its mod. A large save
costs every Hold.

### 6.4 Flight entry

**What happens** `[C]`
- `FlightDriver.Start` is one method, so this is **one frame**: read the
  save, build every vessel, load the active vessel's parts
  (`ProtoPartSnapshot.Load`: every part's modules, `OnLoad`, mod code), or
  for a launch build the ship (`ShipConstruction.LoadShip`), start the
  home body's terrain (`PQS.ForceStart`: subdivide until stable, 6.6), put
  the ship on the ground.
- Then, over later frames: parts' `Start`, terrain refinement on a
  0.1 s-per-frame budget, the first save after 15 frames, `onFlightReady`,
  and the physics hold: 25 frames (75 if landed) plus a ground contact,
  then the vessel is unpacked and the overlay hides.
- KSPCF `PartStartStability` (on) spreads part initialisation over physics
  frames.

**Evidence** `[C]`
- `------------------- initializing flight mode... ------------------`,
  `Loading ship from file: {path}`, `putting ship to ground: {h}`, `Vessel
  assembly complete!`, `all systems started` (end of the long frame),
  `[FLIGHT GLOBALS]: Switching To Vessel {name} ...` (resume), `Unpacking
  {vessel}` (physics on).
- `[R]` KSP-bench, EDITOR → FLIGHT: Scene Change 04:36:58.0; `initializing
  flight mode` 04:37:06.3 (8.3 s: buffered load and scene load); `all
  systems started` 04:37:11.5 (5.2 s, the long frame); `OnSceneLoadedGUIReady`
  04:37:33.3 (21.8 s: the next frame, held by an addon's `Start`, already
  found by `long-stall-by-mod`); `Unpacking Kerbal X` 04:37:36.3; profiler
  end 38.6 s after the request.

**Robustness:** other vessels log `Unpacking` too; match the active
vessel's name. The first save after flight entry is skipped when saving is
not allowed.

**Coverage:** the profiler's Hold and long frames. M5 candidate: *flight
entry breakdown* from these lines (scene load, the setup frame, the frames
after it, the physics hold), at the log-only level.

**Player action:** informational; large vessels and many vessels in range
cost the setup frame.

### 6.5 Editor and space center entry

**What happens** `[C]`
- **Editor:** `EditorDriver.Start` logs `editor started`, loads the save,
  waits for the building's scenery; `EditorLogic.Start` loads the ship if
  one is set (`{ship} loaded!`) and fires `onEditorStarted`. The part list
  (`PartCategorizer.Setup` over every loaded part; one icon object per
  part shown) is built per entry. KSPCF `FasterEditorPartList` (on) speeds
  up the list.
- **Space center:** home-body terrain (`PQS.ForceStart`, synchronous),
  every vessel's `Vessel` object, facility levels.
- **Tracking station:** no terrain; every vessel, plus one list entry per
  vessel.

**Evidence** `[R]` KSP-bench, SPACECENTER → EDITOR (Async): request at
t = 309.14 s (profiler); `onEditorStarted` 315.96; `guiReady` 318.51; the
overlay hides at 319.16, 75 frames after the scene load.

**Coverage:** the profiler's Hold. See the issue below.

### 6.6 Terrain (PQS)

**What happens** `[C]`
- `PSystemSetup` turns the PQS of the scene's body on (space center:
  home; flight: the vessel's body) and resets every other body's.
- `PQS.ForceStart` → `StartSphere` subdivides synchronously until the quad
  count is stable for 10 passes, within the frame; refinement continues on
  a per-frame budget. Subdivision limits come from the Terrain Detail
  setting.
- Terrain mods (Kopernicus, Parallax-style) run inside this work.
- No log line on the normal path; only errors (`PQS {name}: Restarted`,
  `No PQS cache found`).

**What controls it:** the Terrain Detail setting; the number of bodies;
terrain mods.

**Coverage:** not separable from the log. Profiler candidate (M5): time
`PQS.ForceStart` per body (a stock method; check KSPCF's
`PQSCoroutineLeak` transpilers on `StartSphere` first).

### 6.7 Other KSPCF patches in Holds

| Patch | Default | Effect |
|---|---|---|
| `MemoryLeaks` | on | cleans leaked objects when a scene unloads; logs per scene |
| `PartStartStability` | on | part `Start` spread over physics frames |
| `FasterEditorPartList` | on | editor part list |
| `PQSCoroutineLeak` | on | PQS coroutines started by name, so duplicates can be stopped |
| `PQSOnlyStartOnce` | off | skips a second PQS start on launch |
| `FewerSaves` | off | fewer saves when leaving KSC buildings (saves are before the request, 6.1) |
| `FlightSceneLoadKraken` | off (obsolete) | — |
| `EventProfilerMarkers` | off | replaces `GameEvents` `Fire`; would collide with the profiler's event timing if on |

### Area 6: candidate rules for M5

| Candidate | Evidence | Level |
|---|---|---|
| Measured cost for `buffered-scene-switch` | profiler `bufferedLoad` steps and overlay wait (`guiReady` → `Hide`) | profiler |
| Expensive ScenarioModule | profiler `scenario.load` per module and Hold | profiler |
| Flight entry breakdown | `initializing flight mode`, `all systems started`, `Unpacking {active vessel}` | log |
| Terrain start per body | profiler hook on `PQS.ForceStart` | profiler (C#) |

### Area 6: analyzer and profiler issues

1. **The editor Hold ends too early.** The profiler ends a Hold into the
   editor at `onEditorStarted`. On KSP-bench that event fires 2.5 s before
   `guiReady` and 3.2 s before the overlay hides (buffered: 75 frames), so
   SPACECENTER → EDITOR reads 6.8 s where the player waits about 10 s. The
   end should be the later of `guiReady` and the overlay hiding after it,
   for every scene; the profiler's summary is written at that moment too.
   Fix in M5, with area 4's first-frame fix, validated in one KSP-dev run.
2. **`EventProfilerMarkers`** replaces `GameEvents` `Fire` (off by
   default): added to `kspcf-patch-targets.md` with the end of M4.
