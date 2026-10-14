# HyperLoad

Runtime optimization framework for Kerbal Space Program 1 (KSP 1.12.5).
Goal: reduce startup and scene transition times on heavily modded installs
**without requiring changes to existing mods**. Guiding principle: the fastest
loading operation is the one that never has to occur.

Full design: `docs/proposal.md`. Read it before proposing architecture changes.

## Working with Alex

- Talk to Alex in **Brazilian Portuguese**. Code, comments, identifiers, commit
  messages, issues and docs are in **English** (public repo, international modding community).
- Alex is an experienced web developer (TypeScript/Nuxt) and new to C#/Unity/KSP
  modding. Explain Unity/Mono/KSP-specific concepts when they first come up; don't
  over-explain general programming.
- Walk through decisions before large changes. Prefer small, reviewable steps.

## Environment (Windows)

| What | Path | Notes |
|---|---|---|
| Repository | `E:\Projetos\ksp-hyperload` | HDD; fine for source |
| Dev install | `D:\KSP\KSP-dev` | Stock + DLCs only. Build output deploys here |
| Benchmark install | `D:\KSP\KSP-bench` | 180 mods. **Frozen: never modify, never update mods** |
| Benchmark modpack | `D:\KSP\KSP-bench-modpack.ckan` | CKAN export, exact versions, to rebuild the bench |
| Benchmark mod list | `D:\KSP\KSP-bench-modlist.txt` | GameData folder inventory |
| Alex's play install | `D:\SteamLibrary\steamapps\common\Kerbal Space Program` | **Never touch** |

- KSP 1.12.5, Unity 2019.4.18f1, Mono. Target framework: **.NET Framework 4.7.2**.
- Toolchain: .NET SDK 10, VS Code (C# Dev Kit, Unity extension), Git, ILSpy.
- Build tooling: KSPBuildTools (to be set up).
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
assemblies, C# project (`src/HyperLoad`, KSPBuildTools 1.1.1) building and
deploying to KSP-dev, tested in game (bootstrap `[HyperLoad]` log line).
Next: Phase 1 (profiler).

Build notes: the KSP install is set via `KSPBT_GameRoot` (not the old `KSPRoot`)
in `src/HyperLoad/HyperLoad.csproj.user` (gitignored; copy the `.example`). The
csproj refuses auto-discovered or Steam installs.
