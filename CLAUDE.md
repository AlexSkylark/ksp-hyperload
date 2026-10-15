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
diagnostics. The decision write-up and the revised design are still to be
written. Until then, `docs/proposal.md` and the optimization-specific rules
below are historical. Historical docs and archived logs keep the old name.

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

## Environment (Windows)

| What | Path | Notes |
|---|---|---|
| Repository | `E:\Projetos\ksp-hyperload` | HDD; fine for source |
| Dev install | `D:\KSP\KSP-dev` | Stock + DLCs only. Build output deploys here |
| Benchmark install | `D:\KSP\KSP-bench` | 180 mods. **Frozen: never modify, never update mods.** Only exceptions: `GameData\000_TMinus` (our own build) may be installed/updated there (and the old `GameData\000_HyperLoad` removed when it is replaced), and the dedicated save `saves\hyperload-bench` may be restored from `D:\KSP\bench-saves\hyperload-bench` before each run. Never touch the other saves |
| Benchmark save snapshot | `D:\KSP\bench-saves\hyperload-bench` | Reference copy of the bench save; restore it before every transition benchmark so every run starts from the same state |
| Benchmark modpack | `D:\KSP\KSP-bench-modpack.ckan` | CKAN export to rebuild the bench. Mod **names only, no versions**: read versions from the bench's GameData (`*.version` files, DLL names) |
| Benchmark mod list | `D:\KSP\KSP-bench-modlist.txt` | GameData folder inventory |
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

## You cannot run KSP

Claude cannot launch or observe the game. Alex runs it and provides output:

- `KSP.log` in the install root
- `Player.log` in `%USERPROFILE%\AppData\LocalLow\Squad\Kerbal Space Program\`

When a change needs in-game verification, say exactly what to run, what to look
for, and which log lines to send back.

## Benchmarking

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

## Design rules (from the proposal)

1. **Compatibility first.** Unknown situations fall back to vanilla behavior.
2. **Every optimization is optional** and disables itself individually when unsafe.
3. **Measure before optimizing.** No optimization without profiler data showing the cost.
4. **Incremental delivery.** Each phase ships as a stable, independently useful release.
5. Optimization levels: 0 immutable caches (always safe), 1 persistent services,
   2 object residency (validated), 3 scene residency (experimental), 4 unsafe (disabled).

## Ecosystem: coexist, don't duplicate

KSPCommunityFixes and ModuleManager already optimize parts of loading
(e.g. KSPCF's FastLoader, ModuleManager's config cache). Replacing them is a
non-goal. Before implementing any optimization, check whether they already cover
it, and make sure our Harmony patches don't conflict with theirs.

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
offline analysis tool (`tools/analyze/analyze.mts`, Node 24). Phase 1
findings and Phase 2 recommendations: `docs/phase1-findings.md`. Phase 2
go/no-go (2026-10-15): no own optimizations; pivot to diagnostics and rename
to T-Minus (done). Next: write the decision doc and revise the design; a
validation case (fixing the bench mods' MM patch errors and ResearchBodies'
main-menu cost on a copy of the bench) was discussed but not started. The profiler's ~1 % startup overhead is a known,
accepted limitation (Alex chose not to spend more bench runs on it).

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
