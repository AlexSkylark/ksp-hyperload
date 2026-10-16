# T-Minus design

Status: **draft**, 2026-10-15. Open questions are marked **[Open]**.

T-Minus tells a KSP 1 player where loading time goes on their install, and
what they can do about it. Why the project took this direction:
[phase2-decision.md](phase2-decision.md).

## Who it is for

- **Players with heavily modded installs.** They know loading is slow, but
  not why. Experienced modders already know the common causes, such as a
  ModuleManager cache that is never saved. A player still has to find out
  which causes apply to their own install, and how much each one costs.
- **People who help others on the forum and Discord.** Today they read
  `KSP.log` by hand. A generated report saves them that work.

Not the audience: maintainers of KSPCommunityFixes or ModuleManager. They
have proper profilers, and they already know the mechanisms.

## Vocabulary

- **Countdown**: startup, from process start until the main menu responds.
- **Hold**: one scene transition, from the request until the player can act
  (for example "Hold: VAB → Flight, 38.0 s").
- **Finding**: one diagnosed problem. It has a cost, evidence and a
  suggested action.

## What the report says

The report leads with findings, not raw timings. Each finding states:

1. **What** happened, for example: "ModuleManager did not save its cache".
2. **Cost**: measured, or estimated with the method stated.
3. **Evidence**: the log lines or profiler records it comes from.
4. **Action**: what the player can do, with any trade-off.
5. **Confidence**: measured, or heuristic.

After the findings come:
- the Countdown broken down by phase;
- each Hold with its long frames, attributed to mods.

### Findings catalog (first version)

Each rule comes from a mechanism read in the code of KSP, ModuleManager,
KSPCF or Unity; the archived runs only confirmed that the evidence looks as
the code predicts. "Source" says which input detects it. Thresholds are
explained under "Thresholds" below.

| Finding | Detection | Source | Typical action |
|---|---|---|---|
| MM cache not saved | MM's error count and the files it names, or a failed cache write; exceptions and the applied share in notes; cost: MM's own "Waited ... for patching" | log | Fix or remove the patch file named; report it to the mod; for a failed write, check that GameData is writable |
| MM patched from scratch | The dump's cache-check lines give the reason (files changed, DLL set changed, no usable cache, MM or KSP version or a missing file, the check threw); "No TechTree node found" means every startup will be cold; cost: "Waited", from 1 s | log | Informational after a change; with no TechTree node, report the patch on TechTree to its mod |
| Slow ModuleManagerPostLoad callback | `Calling ...ModuleManagerPostLoad()` to MM's next line, summed per mod (upper bound); owner from the assembly in the line, else guessed from the type name | log | Report to the mod |
| ModuleManager failed | `The patching thread threw an exception` (or the logging thread, or no configs) | log | Read the exception; one MM DLL, the 1.12 version |
| -mm-dump on every startup | `Exporting` lines before "Post patch ran in"; `-mm-dump` in KSP's `Args:` line | log | Remove `-mm-dump` unless debugging patches |
| Drag cubes regenerated | Count of `Creating drag cubes` lines in the Countdown; cost measured by the profiler (`SetupDragCubeCoroutine`, first step to last), else estimated from the log gaps after them (upper bound) | log | Usually a consequence of the finding above |
| Buffered scene switches while KSPCF's direct switch is not applied | `(Async)` Scene Change lines, with KSPCF's `Patch ForceSyncSceneSwitch not applied (...)` line and its reason; when the reason is the settings, the MM patches applied to `KSP_COMMUNITY_FIXES` as candidates (e.g. UniversalStorage2), and with the profiler (summary format 2+) whether a patch changed the key or the installed file has it off; cost measured with the profiler: `bufferedLoad` steps plus the overlay's wait into the space center and the editor (lower bound) | log | Know the trade-off; choose between the mod and faster scene switches |
| KSPCF settings not read | The profiler's count of `KSP_COMMUNITY_FIXES` nodes (more than one), else KSPCF's signature in KSP.log: almost every patch off in settings (heuristic); the root and `+` copy node lines name the extra file | log | Remove the extra node; patch KSPCF's settings with `@KSP_COMMUNITY_FIXES` |
| KSPCF PNG texture cache off | FastLoader's `Load PNG texture` lines for eligible files, with no cache hit and no conversion (or the profiler's `textureCacheEnabled`); cost: those files' load times (upper bound) | log | Turn the cache on in `PluginData/PNGTextureCache.cfg` |
| KSPCF PNG texture cache rebuilt | `converted to DXT5 and has been cached` lines; whole cache when there is no hit; cost: the converted files' load times | log | Informational; if every startup rebuilds it, find the crash during loading |
| Expensive addon at startup or in a Hold | Addon `Awake` per mod; `Start` in diagnostic mode | profiler | Report to the mod; decide whether the mod is worth its cost |
| Long stall in the Countdown or a Hold attributed to a mod | Gaps between log lines next to an installed mod's lines: inside long frames (profiler), or inside the space center and flight Holds (log only) | profiler, log (heuristic) | Report to the mod |
| Part compilation per mod | `ParsePart` time per mod | profiler | Informational |
| Expensive ScenarioModule | `ScenarioRunner.AddModule` time per module over the session, by Hold; mod from the module type's assembly (older records: guessed by name) | profiler | Report to the mod; grows with the save |
| Asset loading per mod | Log gaps after each per-file `Load` line, by GameData folder (concurrent FastLoader audio left out) | log (heuristic) | Informational |
| Module code per mod | PartModule Load, Awake, OnStart, OnStartFinished and VesselModule Awake, Start, Load per module type, summed per mod; stock left out | profiler | Report to the mod; grows with the parts and vessels in use |
| Harmony patching per mod | `UpdateWrapper` time per owner (patch and unpatch rebuilds) | profiler | Informational: the price of the mod's patches |
| Patch overhead on a stock method | Other owners' patches bracketed per call, minus the brackets' calibrated cost; owners named per method | profiler (opt-in `harmonyCallHooks`) | Report to the mod |

Each rule is a file in `tools/analyze/src/core/findings`, with its thresholds
as named constants. Mods are recognized only from the run's own
`Load(Assembly)` lines.

### Thresholds

Reviewed in M5 step 9 (2026-10-16). Each threshold has a reason that does
not depend on any install. None was set from the bench.
- **Absolute seconds, not a share of the Countdown.** A player waits the
  same second on a small install and on a large one. A threshold relative
  to the Countdown would hide on a large install a cost that a small one
  shows.
- **1 s for every measured or estimated cost** (`MIN_SECONDS`, `MIN_MS`):
  addons, part modules, ScenarioModules, Harmony patching, patch-call
  overhead, MM's cold start and post-load callbacks, asset loading, drag
  cubes, the PNG texture cache. A second is about the smallest wait a
  player notices in a loading screen. Below it, the action (report it to a
  mod, remove a mod) costs more than it saves.
- **0.5 s for `-mm-dump`**: the export is pure waste outside debugging, and
  the action (drop a launch option) has no trade-off, so a smaller cost is
  still worth saying.
- **2 s for log-gap attribution** (`long-stall-by-mod`): attributing a gap
  to a mod is a guess, so this rule needs twice the evidence of a measured
  cost: at least 2 s per mod in each Countdown or Hold. When only KSP.log
  is read, each gap must also be at least 2 s, the profiler's long-frame
  threshold. That keeps the ordinary spacing of lines within a loading
  frame from becoming a finding.
- **KSPCF's settings signature** (20 patch lines, 90 % off): a KSPCF that
  has read its settings applies most of its keyed patches, which are on by
  default. The 20-line floor keeps a KSPCF with few patches (an old version)
  from matching.
- **1 s overlay slack** (`buffered-scene-switch`): the overlay's record
  can come after the record of the transition's end. A one-second
  allowance covers a slow frame between them. It is a matching window,
  not a cost threshold.
- **Display only:** the phase table drops "other" stretches under 0.05 s.

A threshold changes only when its reason changes (a new mechanism or a
player-facing argument), never to make an install's report shorter.

Rules for findings:
- **No finding without evidence from this install.**
- **No curated list of "known heavy mods".** We decided against it on
  2026-10-15:
  - one maintainer can't keep such a list current;
  - it reads as blaming mods.
  Findings stay generic: they name the mod that measured costly, without
  mod-specific advice. A list could come back later only as a collaborative
  effort, with entries contributed and kept current by the community.
- **Heuristic attribution says so.** Log-gap attribution guesses who did the
  work.
- **The action never implies T-Minus will fix it.** T-Minus does not change
  the game.

## Components

```text
KSP install
├── KSP.log ───────────────┐
└── 000_TMinus (optional)  │
    └── run-*.jsonl ───────┤
                           ▼
                Analyzer core (TypeScript)
                ├── parsers: KSP.log, profiler jsonl
                ├── model: Countdown, Holds, frames, per-mod costs
                └── findings rules
                           │
               ┌───────────┴───────────┐
               ▼                       ▼
         CLI (Node 24)          Web page (client-side)
         Markdown report        HTML report
```

### In-game profiler (exists)

- The C# mod in `GameData/000_TMinus`. It records the profiler `.jsonl`.
- It adds what the log cannot give: per-addon `Awake`/`Start` attribution,
  per-mod part parsing, and exact Countdown and Hold boundaries.
- Overhead is ~1 % of startup and not measurable on transitions.

### Analyzer core

- Lives in `tools/analyze` (M2): `src/core` (parsers, model), `src/report`
  (Markdown) and `src/cli` (file I/O). `core` and `report` use no Node or
  DOM APIs, so the web page can reuse them.
- Source in TypeScript, shipped as compiled JavaScript (`tsc`) for both the
  CLI and the web page, so users need no TypeScript toolchain. The page's
  build runs in CI (GitHub Actions).
- **Three input levels:**
  - `KSP.log` only: no install needed. Most of the big findings already come
    from the log.
  - `KSP.log` with the profiler's summary (see "In-game summary" below):
    every rule runs; addons and part folders are cut to the top ten per
    Countdown or Hold.
  - `KSP.log` plus the profiler `.jsonl`: full attribution.
- The report always says which level it ran at, and what the missing input
  would add.

### Front ends

- **CLI:** for us, and for anyone comfortable with Node.
- **Web page:** paste or drop a `KSP.log` (and a `.jsonl`) and get the
  report. All processing happens **in the browser**: logs never leave the
  machine. Logs contain usernames and paths.
- [Open] Where the page is hosted (GitHub Pages is the simple option).
- **In-game summary in `KSP.log`.** At the end of loading (and after each
  Hold), the mod writes a short summary of the profiler's key numbers to
  `KSP.log`. A player who only posts their log still shares them.
  Decided 2026-10-15, built in M3b:
  - One `[TMinus] Summary` block when the main menu is ready and one after
    each Hold, one item per line: long frames (≥ 2 s) with their start
    time, the ten costliest addon `Awake`/`Start` entries and part folders,
    an `(other)` line, and a closing line with totals.
  - Format 2 (M5) adds: collections per long frame, ScenarioModules and
    terrain starts, the buffered switch's steps and the overlay wait after
    GUI ready, memory at the end of each block, large managed growth per
    addon, and in the Countdown block the GC mode and KSPCF settings changed
    by patches. The parser reads formats 1 and 2.
  - Times are seconds since process start; the opening line states its own
    time, which anchors them to the log clock. It carries a format number:
    the C# writer (`LogSummary.cs`) and the analyzer's parser
    (`core/summary.ts`) change together.
  - Setting `logSummary` (on by default). Any failure turns it off for the
    session.

## Principles

1. **Measuring never changes the game.**
   - Hooks only time code; every hook group can be turned off.
   - Unknown situations: record less, never behave differently.
2. **Never patch a mod's methods ahead of time.** Harmony compiles a method
   when it patches it, which can run the mod's static constructors early.
   This broke KerbalConstructionTime once. Mod hooks stay opt-in and lazy.
3. **Honest numbers.**
   - Measured and inferred values are labeled as such.
   - Bench-specific conditions are stated.
   - A report from one run says that it is one run.
4. **Coexist, don't duplicate.** KSPCF and ModuleManager own loading
   optimizations. T-Minus measures them and explains them; it does not
   replace them.
5. **Privacy.** The web page processes logs locally.
6. **Generic and mod-agnostic** (decided 2026-10-15). T-Minus must find
   bottlenecks with any mods: those installed today, future ones, and new
   versions of existing ones.
   - Rules come from mechanisms: how stock KSP loads and calls mods, and
     how ModuleManager, KSPCF and Harmony work, read in their code.
   - No rule, threshold or action is tuned to one install. `KSP-bench` is a
     regression fixture for the analyzer, never a target to optimize.
   - Logs and versions the code did not foresee: parse what is known,
     report less, never guess.

## Non-goals

- Joining KSPModdingLibs or merging into another project, for now. T-Minus
  starts as a standalone mod, offered to the community (decided 2026-10-15).
- Optimizing loading in our own code (see the decision document).
- Fixing mods automatically, or changing their settings.
- KSP 2.

## Roadmap

Each milestone is small and can be reviewed on its own.

| # | Milestone | Bench runs |
|---|---|---|
| M1 | This document, the decision record, CLAUDE.md updated | 0 |
| M2 | Analyzer core refactor: separate parsing, model and report. Same output as today, checked against the archived runs | 0 |
| M3 | Findings engine with the first catalog, tested on the archived bench and dev runs. Done 2026-10-15 | 0 |
| M3b | In-game summary in `KSP.log` at the end of loading and of each Hold, validated on KSP-dev; the analyzer reads it at the log-only level. Before M4, so the bench's swap to `000_TMinus` already includes it. Done 2026-10-15 | 0 |
| M4 | Mechanism survey (`docs/mechanisms.md`): from the code of KSP, ModuleManager, KSPCF and Harmony, where loading and scene switches spend time, what mods or settings control, and what evidence each mechanism leaves in `KSP.log` or the profiler. Replaces the earlier `KSP-tuned` validation case (dropped 2026-10-15: it tuned one install). Done 2026-10-15; its "Summary for M5" is M5's input | 0 |
| M5 | Rules for the mechanisms the survey finds, tested with synthetic logs written from the code and, where needed, with scenario installs built on purpose (e.g. a copy of KSP-dev with a broken MM patch). Done 2026-10-16 (`docs/m5-profiler-plan.md`); validated on KSP-dev, KSP-scenario and one KSP-bench run (`docs/benchmarks/results.md`) | 0 |
| M6 | Web page: the analyzer in the browser (see "Front ends") | 0 |
| M7 | First public release: the mod, the page, a forum thread | 0 |

The community post that was to test demand before the web page was dropped
on 2026-10-16. Alex decided that T-Minus will be completed either way, so the
page does not wait for a demand check.

The bench's swap from `000_HyperLoad` to `000_TMinus` was done on 2026-10-16,
before the M5 validation run.

## Open questions

- [Open] Where the web page is hosted (see "Front ends").

Resolved:
- **Is a mod's effect on KSPCF settings visible in `KSP.log`?** Partly
  (2026-10-15; revised in M4, see `mechanisms.md` area 2):
  - **Each patch's state is in the log.** KSPCF logs one line per patch,
    applied or not, with the reason. The wording changed in 1.37, so the
    analyzer parses the lines by structure.
  - **Defaults and setting values are not in the log.** The analyzer keeps
    no table of defaults: it reports effects the log shows, such as
    `(Async)` scene switches while KSPCF's direct switch is not applied.
  - **Who changed a setting is only a candidate.** MM's patch log names
    each patch on KSPCF's settings, but not what it changes, so those
    patches are listed as candidates.
  - Reading the installed `Settings.cfg` against KSPCF's effective settings
    is a candidate for the profiler (M5).
