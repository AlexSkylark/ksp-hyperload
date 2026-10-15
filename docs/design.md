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

Built from what the bench run showed. "Source" says which input detects it.

| Finding | Detection | Source | Typical action |
|---|---|---|---|
| MM cache not saved | MM's error count and the files it names | log | Fix or remove the patch file named; report it to the mod |
| Drag cubes regenerated | Count of `Creating drag cubes` lines, timed by the profiler | log, profiler | Usually a consequence of the finding above |
| KSPCF optimization turned off by another mod's patch | KSPCF settings plus the MM patches that change them, e.g. `ForceSyncSceneSwitch` off because of UniversalStorage2 | log [Open: is it visible in the log?] | Know the trade-off; choose between the mod and the speed-up |
| Expensive addon at startup or in a Hold | Addon `Awake` per mod; `Start` in diagnostic mode | profiler | Report to the mod; decide whether the mod is worth its cost |
| Long frame in a Hold attributed to a mod | Long frames plus gaps between log lines | profiler, log (heuristic) | Report to the mod |
| Part compilation per mod | `ParsePart` time per mod | profiler | Informational |

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

- Grows out of `tools/analyze/analyze.mts`.
- Source in TypeScript, shipped as compiled JavaScript (`tsc`) for both the
  CLI and the web page, so users need no TypeScript toolchain. The page's
  build runs in CI (GitHub Actions).
- **Two input levels:**
  - `KSP.log` only: no install needed. Most of the big findings already come
    from the log.
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
  Decided 2026-10-15.

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
| M3 | Findings engine with the first catalog, tested on the archived bench and dev runs | 0 |
| M4 | Validation case on a copy of the bench (`KSP-tuned`): apply the actions from M3's report and measure before and after. Swap the bench's mod folder to `000_TMinus` at the same time | 4 |
| M5 | Community post: a HyperLoad post-mortem (what we measured, why optimizing didn't pay), offering T-Minus to the community, with M4's numbers. It doubles as the demand check | 0 |
| M6 | Web page, if M5 shows interest | 0 |
| M7 | First public release: the mod, the page, a forum thread | 0 |

## Open questions

- [Open] Is a mod's effect on KSPCF settings visible in `KSP.log`, or does
  the analyzer need the profiler (or the MM config cache) to see it?
