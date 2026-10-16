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
the code predicts. The thresholds (2 s, 1 s) are provisional: they were set
while looking at one install. "Source" says which input detects it.

| Finding | Detection | Source | Typical action |
|---|---|---|---|
| MM cache not saved | MM's error count and the files it names; cost: MM's own "Waited ... for patching" | log | Fix or remove the patch file named; report it to the mod |
| Drag cubes regenerated | Count of `Creating drag cubes` lines in the Countdown; cost estimated from the log gaps after them (upper bound) | log | Usually a consequence of the finding above |
| Buffered scene switches while KSPCF's direct switch is not applied | `(Async)` Scene Change lines, with KSPCF's `Patch ForceSyncSceneSwitch not applied (...)` line and its reason; when the reason is the settings, the MM patches applied to `KSP_COMMUNITY_FIXES` as candidates (e.g. UniversalStorage2) | log | Know the trade-off; choose between the mod and faster scene switches |
| Expensive addon at startup or in a Hold | Addon `Awake` per mod; `Start` in diagnostic mode | profiler | Report to the mod; decide whether the mod is worth its cost |
| Long stall in the Countdown or a Hold attributed to a mod | Gaps between log lines next to an installed mod's lines: inside long frames (profiler), or inside the space center and flight Holds (log only) | profiler, log (heuristic) | Report to the mod |
| Part compilation per mod | `ParsePart` time per mod | profiler | Informational |

Each rule is a file in `tools/analyze/src/core/findings`, with its thresholds
as named constants. Mods are recognized only from the run's own
`Load(Assembly)` lines.

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
  - Times are seconds since process start; the opening line states its own
    time, which anchors them to the log clock. It carries a format number
    (`format 1`): the C# writer (`LogSummary.cs`) and the analyzer's parser
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
| M5 | Rules for the mechanisms the survey finds, tested with synthetic logs written from the code and, where needed, with scenario installs built on purpose (e.g. a copy of KSP-dev with a broken MM patch) | 0 |
| M6 | Community post offering T-Minus. [Open] Whether it includes a HyperLoad post-mortem. It doubles as the demand check | 0 |
| M7 | Web page, if M6 shows interest | 0 |
| M8 | First public release: the mod, the page, a forum thread | 0 |

The bench's swap from `000_HyperLoad` to `000_TMinus` is maintenance: it
happens before the next bench run, whenever there is one.

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
