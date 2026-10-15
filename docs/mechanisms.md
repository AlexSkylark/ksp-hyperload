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
2. KSPCommunityFixes across versions (to do)
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

1. **`mm-cache.ts` guesses when the dump is missing.** `mmDump` falls back
   to the whole log. It should report that the MM evidence is missing
   (1.6).
2. **Dump lines are parsed as ordinary log lines.**
   - Their timestamps run up to minutes behind their position in the file.
   - `gaps()` walks the file in order, so a window that contains the dump's
     position can mix times from two clocks.
   - The parser should mark lines inside the MM dump, and inside its nested
     patch log, as embedded. Timeline code should skip them, and MM rules
     should read them.
3. **The nested patch log of a cache startup belongs to an earlier run**
   (1.3, 1.6). Rules must not read it as this run's events.
4. **Worker-thread numbers can use `,`** (1.1).
5. **The profiler misses the first long loading frame.** On run
   `20261015-043911`, about 22 s of main-thread work (`Instantly` addons'
   `Awake`, the config parse, FastLoader's start) lies between profiler
   t ≈ 11.7 s and 33.7 s, but no `frame.long` covers it. To be checked in
   areas 4 and 5, which own that frame.
