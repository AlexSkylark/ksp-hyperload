# T-Minus

Startup and scene-transition diagnostics for Kerbal Space Program 1
(KSP 1.12.5): an in-game profiler plus a log analyzer that together tell a
player where loading time goes on their install and what to do about it.
In the report, startup is the **Countdown** and each scene transition is a
**Hold**.

The project was called **HyperLoad** until 2026-10-15 and began as a runtime
optimization framework (`docs/proposal.md`). Phase 1 data showed that
optimizing in our own code has a low ceiling: most of the cost is mod work,
and KSPCF already covers the stock targets. The project then pivoted to
diagnostics. Decision and evidence: `docs/phase2-decision.md`. Design (draft,
read it before proposing architecture changes): `docs/design.md`.
`docs/proposal.md` is historical. Historical docs and archived logs keep the
old name.

## Working with Alex

- Talk to Alex in **Brazilian Portuguese**. Code, comments, identifiers, commit
  messages, issues and docs are in **English** (public repo, international modding community).
- Alex is an experienced developer in TypeScript/Nuxt and in C#/Unity, and new
  to KSP modding. Explain KSP-specific internals when they first come up; don't
  over-explain general programming, C# or Unity.
- Walk through decisions before large changes. Prefer small, reviewable steps.
- **No AI attribution in the repo.** Never add `Co-Authored-By` trailers,
  "Generated with Claude Code" lines or similar to commits, PRs, issues or
  releases. All repo activity appears as Alex (alexskylark) only.

## Context discipline (Claude)

Sessions here are long and auto-compact at 200k tokens
(`.claude/settings.json`). This file is re-read after every compaction;
the conversation is not. So:

- **Durable state lives in files, not in the chat.** Before ending a step
  (commit), make sure its outcome, deferred items and next step are in the
  repo: the step's doc, `## Status` below, or a `TODO`/deferred list in the
  doc it belongs to. Nothing needed later may exist only in the conversation.
- **Read narrowly.** Large files (`docs/mechanisms.md`, decompiled sources,
  `KSP.log`): grep first, then read by line range. Never re-read a file to
  check an edit.
- **Delegate bulk reading.** Questions about KSP/MM/KSPCF/Harmony internals
  go to the `ksp-reference` subagent, which returns a summary; verify only
  the claims that become rules.
- **Keep command output short.** Filter with `grep`/`tail`; don't dump whole
  logs, test outputs or reports into the context.
- **In-progress work.** When a step spans many turns, keep a short
  "In progress" note under `## Status` (what is done, what is next, agent ids
  worth resuming) and remove it when the step is committed.

## Environment (Windows)

| What | Path | Notes |
|---|---|---|
| Repository | `E:\Projetos\ksp-tminus` | GitHub `AlexSkylark/ksp-tminus`. HDD; fine for source |
| Dev install | `D:\KSP\KSP-dev` | Stock + DLCs only. Build output deploys here |
| Scenario install | `D:\KSP\KSP-scenario` | Copy of KSP-dev (2026-10-15) plus KSPCF 1.41.1 (without its `PluginData`), ModuleManager 4.2.3 and Harmony, copied from KSP-bench. For M5 cases built on purpose (broken MM patch, KSPCF settings changed by a patch, ...); each case is documented with its run. Ours to change. Not a build target: `tools/run/Invoke-Run.ps1 -Install scenario` deploys there (its own switch: `patchInventory = true`) |
| Save snapshots (dev, scenario) | `D:\KSP\dev-saves\hyperload-dev`, `D:\KSP\scenario-saves\hyperload-dev` | Restored by `Invoke-Run.ps1` before every run. Pad cleared, crew Available (protocol, "Automated runs") |
| Benchmark install | `D:\KSP\KSP-bench` | 180 mods. **Frozen: never modify, never update mods.** Only exceptions: `GameData\000_TMinus` (our own build) may be installed/updated there (and the old `GameData\000_HyperLoad` removed when it is replaced), and the dedicated save `saves\hyperload-bench` may be restored from `D:\KSP\bench-saves\hyperload-bench` before each run. Never touch the other saves |
| Benchmark save snapshot | `D:\KSP\bench-saves\hyperload-bench` | Reference copy of the bench save; restore it before every transition benchmark so every run starts from the same state |
| Benchmark modpack | `D:\KSP\KSP-bench-modpack.ckan` | CKAN export to rebuild the bench. Mod **names only, no versions**: read versions from the bench's GameData (`*.version` files, DLL names) |
| Benchmark mod list | `D:\KSP\KSP-bench-modlist.txt` | GameData folder inventory |
| Run archive | `D:\KSP\bench-runs`, `D:\KSP\dev-runs`, `D:\KSP\scenario-runs` | One folder per run (`KSP.log`, `.jsonl`) |
| Run expectations | `D:\KSP\expectations.json` | What `check-archived` verifies per install. Kept out of the repo: install-specific |
| Alex's play install | `D:\SteamLibrary\steamapps\common\Kerbal Space Program` | **Never touch** |

- KSP 1.12.5, Unity 2019.4.18f1, Mono. Target framework: **.NET Framework 4.7.2**.
- Toolchain: .NET SDK 10, VS Code (C# Dev Kit, Unity extension), Git, ILSpy.
- Build tooling: KSPBuildTools 1.1.1 (NuGet).
- KSP is DRM-free: copies run directly via `KSP_x64.exe`.

### Hardware caveat

Drive D: is an NVMe SSD on a PCIe x1 adapter that had I/O dropouts (Windows
Event ID 51) on 2026-10-14. Reseated and PCIe ASPM disabled since. If you see
unexplained read failures, hangs, or "corrupted" files under D:, suspect the
disk before suspecting code, and tell Alex.

## Running KSP

Claude may run validation runs on **KSP-dev and KSP-scenario only**, through
`tools/run/Invoke-Run.ps1 -Install dev|scenario [-Set @{ switch = 'true' }]`
(Alex decided this on 2026-10-16). Details are in the protocol's
"Automated runs".
- Run it in the background. It opens the game window on Alex's screen, so
  say so before starting.
- The script:
  - builds and deploys;
  - writes `Settings.cfg` from the repo's file plus the install's own
    switches and `-Set`;
  - restores the save from `D:\KSP\dev-saves` / `D:\KSP\scenario-saves`;
  - plays the route with the dev-only driver (`src/TMinus.Route`,
    `-tminus-route`);
  - archives the run with `conditions.txt` and `report.md`;
  - prints its `check-archived` line.
- Claude never launches KSP-bench (bench series stay manual, run by Alex
  with `Prepare-BenchRun.ps1`) or Alex's play install.
- What the route cannot see (UI, popups, anything visual) still needs Alex.
  In that case, say exactly what to run, what to look for, and which log
  lines to send back. Logs:
  - `KSP.log` in the install root;
  - `Player.log` in `%USERPROFILE%\AppData\LocalLow\Squad\Kerbal Space Program\`.

## Benchmarking

- **T-Minus is generic and mod-agnostic** (design principle 6): rules come from
  mechanisms read in the code of KSP, MM, KSPCF and Harmony, and must work with
  future mods and new mod versions. `KSP-bench` is a regression fixture and a
  place to measure the profiler's own overhead: never tune rules, thresholds or
  actions to it, and never optimize it.
- All performance claims are measured on `KSP-bench`, same conditions, multiple runs.
- Baseline (stopwatch, launch to main menu, 2026-10-14): **dev 1:11, bench 4:20**.
  Rough reference only; Phase 1 profiler replaces this with per-phase timings.
- Record every benchmark result with date, commit, and conditions.

## Legal: decompiled code

- Decompiled KSP assemblies live **outside the repo**, in
  `E:\Projetos\ksp-reference\1.12.5\<AssemblyName>\` (ilspycmd `-p` projects of
  `Assembly-CSharp` and `Assembly-CSharp-firstpass` from KSP-dev). Use them to
  understand game behavior. Claude can read them via `additionalDirectories` in
  `.claude/settings.local.json` (gitignored).
- Mod sources for reference live in `E:\Projetos\ksp-reference\mods\`, git
  clones checked out at the tags installed in KSP-bench: KSPCommunityFixes
  `1.41.1` (MIT), ModuleManager `v4.2.3` (CC share-alike, **not**
  MIT-compatible: never copy its code) and Harmony `v2.2.1.0` (MIT). If the
  bench's mods ever change, re-checkout the matching tags.
- For questions about KSP internals or these mods, use the read-only
  `ksp-reference` subagent (`.claude/agents/ksp-reference.md`). It returns
  summaries with file paths and class/method names, never decompiled code.
- **Never commit decompiled code or any KSP/Unity DLL.** Never paste decompiled
  code verbatim into the source tree; write our own implementation.
- License: MIT. Every dependency must be license-compatible.

## Design rules (from `docs/design.md`)

1. **Measuring never changes the game.** Hooks only time code; every hook
   group can be turned off; in unknown situations record less, never behave
   differently.
2. **No optimizations of our own.** If we find a fix, it goes upstream (KSPCF,
   the mod) as data or a PR.
3. **Honest numbers.** Label measured vs inferred; state bench conditions; no
   finding without evidence from the analyzed install.
4. **Privacy.** Logs contain usernames and paths: the web analyzer processes
   them in the browser only.
5. **Incremental delivery.** Small, reviewable milestones (roadmap in the design).

## Ecosystem: coexist, don't duplicate

KSPCommunityFixes and ModuleManager own loading optimizations (e.g. KSPCF's
FastLoader, ModuleManager's config cache). T-Minus measures and explains them,
never replaces them. Make sure our Harmony hooks don't conflict with KSPCF's
(`docs/kspcf-patch-targets.md`).

## Status

Setup phase. Done: KSP installs, toolchain, repo skeleton, decompiled reference
assemblies, C# project (`src/TMinus`, KSPBuildTools 1.1.1) building and
deploying to KSP-dev, tested in game (bootstrap `[TMinus]` log line).
Phase 1 (profiler): scope, research and architecture agreed in
`docs/phase1-profiler-scope.md`; KSPCF patch targets in
`docs/kspcf-patch-targets.md`. Done: steps 0–3 (core, loader timing, startup
hooks, per-addon Awake, scene transitions) plus lazy per-addon Start
(diagnostic, off by default), validated on KSP-dev and KSP-bench; benchmark
protocol (`docs/benchmarks/protocol.md`, `tools/bench/Prepare-BenchRun.ps1`)
and a first controlled series (2026-10-15). Results log:
`docs/benchmarks/results.md`. Also done: GameEvent dispatch timing and the
offline analysis tool (`tools/analyze`, Node 24). Phase 1
findings and Phase 2 recommendations: `docs/phase1-findings.md`. Phase 2
go/no-go (2026-10-15): no own optimizations; pivot to diagnostics and rename
to T-Minus (done, validated on KSP-dev; KSP-bench swapped to `000_TMinus`
2026-10-16, old folder kept at `D:\KSP\bench-runs\_retired-000_HyperLoad`
with one unarchived `.jsonl`). Decision record and draft
design written (roadmap milestone M1). M2 done (2026-10-15): the analyzer is
a TypeScript package in `tools/analyze` (`src/core` parsers + model,
`src/report` Markdown, `src/cli` I/O; build with `tsc`, TypeScript the only
dev dependency). Output was checked byte for byte against the old
`analyze.mts` on every archived run. `core` and `report` must stay free of
Node and DOM APIs (`tsconfig.core.json` enforces it). M3 done (2026-10-15):
findings engine in `src/core/findings` (one rule per file) with the
design's first catalog; the report leads with findings. Tests:
`npm --prefix tools/analyze test` (synthetic logs) and
`dist/cli/check-archived.js D:\KSP\expectations.json` on the local run
archive (see the protocol's "Analysis"). M3b done (2026-10-15): the profiler writes a `[TMinus] Summary`
block to `KSP.log` at the main menu and after each Hold
(`Profiler/LogSummary.cs`, setting `logSummary`), and the analyzer reads it
when there is no `.jsonl` (`core/summary.ts`, input level `log+summary`);
validated on KSP-dev. Writer and parser share a format number: change them
together. 2026-10-15: the `KSP-tuned` validation case was dropped (it
tuned one install); the roadmap was reworked around design principle 6.
M4 done (2026-10-15): the mechanism survey `docs/mechanisms.md`, eight
areas (ModuleManager, KSPCF, PartLoader, GameDatabase, assemblies and
addons, Holds, Harmony, memory and GC), each mechanism with its evidence
checked against the code and the bench runs. Along the way the analyzer
gained the run expectations file, a parser that keeps MM's log dump out of
the timeline, `buffered-scene-switch` (replacing a KSPCF defaults table),
and lost a misleading drag-cube profiler number. Decided: Player.log is
not an analyzer input; content problems (dropped parts, missing
dependencies, failed patches) are not findings.
M5 done (2026-10-16). Plan, research, decisions and per-step results are in
`docs/m5-profiler-plan.md`; the bench validation is in
`docs/benchmarks/results.md`. What it added:
- Profiler (summary format 3; format 4 since M6 step 1b): module dispatch, with per-module `OnStart`
  through an `ApplyUpgrades` marker because Mono inlines `SetPartModule`.
  Harmony patching cost per owner. Per-call brackets on patched stock
  methods (opt-in `harmonyCallHooks`).
- Analyzer:
  - assets per file from KSP.log;
  - findings from profiler data;
  - MM and KSPCF log rules;
  - Countdown, MM and flight-entry phases from KSP.log alone
    (`core/phases.ts`);
  - a reason for each threshold (design's "Thresholds").
- Validation runs:
  - KSP-dev and KSP-scenario: last pair `dev-runs/20261016-095302` and
    `scenario-runs/20261016-095456`;
  - KSP-bench: `bench-runs/20261016-103746`.

Facts that still hold:
- KSP-scenario has `patchInventory = true` and two cases:
  - `GameData/TMinusScenario/kspcf-buffered-switch.cfg`: KSPCF's
    `ForceSyncSceneSwitch` turned off through an MM patch;
  - `rse`: RocketSoundEnhancement and its Default config pack, copied from
    KSP-bench.
- Its suite is in `D:\KSP\expectations.json`. Expectations get checks but
  never feed rules. `when.summaryFormat` gates checks on data that older
  profilers did not record.
- Runs from a build with a known writer bug go to `_invalid/` in their
  archive, with a `reason.txt`.
- `check-archived` compares the summary's findings with the .jsonl's only
  when the run uses the current summary format.
- The profiler's ~1 % startup overhead is a known, accepted limitation.
  Alex chose not to spend more bench runs on it.

Next: M6, the self-contained mod (Alex, 2026-10-16): a player installs
T-Minus and the mod orchestrates everything (inputs, analysis, report),
with no Node or command line. The web page is M7, the release M8 (design
roadmap; the community post as a demand check was dropped 2026-10-16).

In progress (M6): report output decisions taken 2026-10-16 (three reading
levels, grouping by mod, share link in the URL fragment, English only),
recorded with measurements in `docs/m6-web-plan.md`. Mockup v3
version 5 approved for an alpha (2026-10-16). Alpha decisions taken
(plan's "Alpha: the mod writes the report"). KSP.log writing research
done and recorded there. Step 1a (`Finding.mods` plus rule-text audit)
done. Player's journey decided (plan's "The player's journey",
2026-10-16). Report model shape and decisions taken (plan's "Report model:
shape and decisions"). Step 1b done (summary format 4: covered runs per
long frame; `long-stall-by-mod` leaves measured time out of log silences;
validated on dev/scenario, a bench run would show its numbers). Next: step
1, the report model, then the work list in order.

Never patch a mod's own methods ahead of time: Harmony compiles the method
when patching, which can run static constructors early (this broke
KerbalConstructionTime once). Patch mod code only after the game has
instantiated the type, and keep such hooks opt-in.

Mod folder is `GameData\000_TMinus` (early load order, so the profiler's
Instantly addon runs before most others).

Bench facts that affect every measurement: ModuleManager never writes its
cache there (patch errors in ChemicalPropulsion), so every startup is MM cold;
KSPCF FastLoader is always on; `ForceSyncSceneSwitch` is off (UniversalStorage2).

Build notes: the KSP install is set via `KSPBT_GameRoot` (not the old `KSPRoot`)
in `src/TMinus/TMinus.csproj.user` (gitignored; copy the `.example`). The
csproj refuses auto-discovered or Steam installs.
