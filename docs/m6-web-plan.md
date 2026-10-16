# M6 plan: the report for players, and the web page (draft)

M6 in the design's roadmap is the web page. Before building it, the report's
output was reworked around one goal: a player gets a report that is easy to
read, good to look at, easy to share, and that a technical reader can expand
down to the evidence.

## Decisions (Alex, 2026-10-16)

1. **Three reading levels on one page.**
   - **Summary** (open by default): one headline sentence, the three to five
     main points of attention in plain words (problem, cost, what to do), and
     where the time went.
   - **By mod** (expandable): findings grouped by mod, largest impact first.
     Findings that belong to no single mod (ModuleManager's cache, drag cubes,
     the buffered scene switch, part compilation) go in an install-wide group.
   - **Technical details** (collapsed): evidence lines, Countdown phases,
     Holds and their long frames: everything the Markdown report has today.
2. **Sharing.**
   - **Link with the report in the URL fragment** (`#...`): the redacted
     report model, compressed. The fragment is never sent to the server, so
     the privacy principle holds and static hosting is enough.
   - **Copy summary**: short text for forums, Reddit and Discord that reads
     on its own (the link may not fit, see "Measurements").
   - **Download**: one self-contained HTML file that opens offline.
3. **Grouping by mod**, largest impact first, rather than by finding family.
4. **English only** for now; no i18n scaffolding.
5. **Name every mod; no generic sentences** (rule added to the design's
   "What the report says"). Prompted by mockup v1, which said "A mod's patch
   turns off KSPCommunityFixes' faster scene switch".

## Name the patch behind each changed KSPCF setting

`buffered-scene-switch` lists as candidates every MM patch applied to
KSPCF's settings, because KSP.log shows that a patch was applied but not
which keys it sets. On the bench that names three mods, and only one is
right:

| Patch file | Keys it sets |
|---|---|
| `KSPCommunityFixes/MMPatches/ModSupport/UniversalStorage.cfg` (`NEEDS[UniversalStorage2]`) | `ForceSyncSceneSwitch = false` |
| `KerbalJointReinforcement/KSPCommunityFixes.cfg` | `DockingPortLockedEvents` |
| `Kopernicus/Config/KSPCF_DisableMapSOPatches.cfg` | `MapSOCorrectWrapping`, `ScatterDistribution`, `ROCValidationOOR` |

Proposal: the profiler, which already records each changed key (installed
-> effective), also records which patch sets it: the `@KSP_COMMUNITY_FIXES`
patch nodes, matched by key, last applied wins. Read only; the summary and
the analyzer carry the patch and the mod it serves (its `NEEDS`, or its
folder). At the log-only level the analyzer keeps the candidate list.
Research before building: when the patch nodes can be read (MM removes
them from the database after patching; startups from MM's cache apply no
patches), and the summary format change.

Audit: the other rules' texts get the same check (no unnamed mod, no
generic sentence) before the report model is built.

## Measurements (bench run `20261016-103746`, 2026-10-16)

| Payload | JSON | deflate + base64 |
|---|---|---|
| Full `RunAnalysis` | 3.4 MB | 311 KB |
| `countdown.assets` alone | 3.2 MB | — |
| Findings only, full evidence | 39 KB | 9.9 KB |
| Curated: findings (evidence ≤ 3 lines, ≤ 160 chars), phases, Holds, flight entries, install | — | 10.1 KB |
| Rule ids and numbers only (page regenerates the text) | — | 3.6 KB |

Consequences:
- The link carries a curated report model, never the full analysis.
- A ~10 KB link works in browsers, the KSP forum and GitHub; it does not fit
  a Discord message (2000 chars) or a Reddit comment (10,000). The copied
  summary must stand without the link there. Shorter links (an outside paste
  host, or text regenerated from ids) are deferred.

## Design notes

- **Report model** (new, in `src/report` or `src/core`, pure and
  serializable): headline, points of attention, mod groups, install-wide
  group, technical sections, and redaction of usernames and paths. Ranking
  and grouping are decided once there; the Markdown, HTML and short-text
  renderers only render it, so the three formats never disagree.
- **Mod attribution needs a structured field.** `Finding.subject` mixes a mod
  with its author (`ResearchBodies (REPOSoftTech)`), alternatives
  (`ScienceAlert or ShipEffectsContinued`), KSPCF patch names
  (`ForceSyncSceneSwitch`) and file paths, and is absent on some findings.
  Rules should state the mods they name, each with a role (culprit or
  candidate).
- **Honest totals.** The headline's recoverable time must not add a finding
  to the one it follows from (`related`: drag cubes follow from the MM
  cache). Per-mod totals must not add overlapping costs (a long frame can
  contain an expensive Awake) or mix heuristic and measured costs without
  saying so.

## Alpha: the mod writes the report (proposal, 2026-10-16)

Alex approved mockup version 5 for an alpha release. Next goal: the mod
produces that report itself when the player asks for it, with no Node and no
command line.

Principle: one analyzer. The TypeScript core already runs without Node or
DOM APIs (`tsconfig.core.json`), so the browser runs it. The C# side only
collects the inputs and opens the page; it never re-implements parsing or
rules.

Flow:
1. The player clicks the T-Minus button on the stock toolbar (Space Center,
   Editor, Tracking Station, Flight).
2. On a background thread, the mod reads `KSP.log` (shared read) and this
   run's `.jsonl`, gzips them, and writes one HTML file to
   `GameData/000_TMinus/PluginData/Reports/tminus-<date>.html`: the page
   template, which the mod ships, plus the inputs embedded as base64.
3. The mod opens the file in the default browser (`Application.OpenURL`).
4. The page decompresses the inputs (`DecompressionStream`), runs the
   analyzer, builds the report model and renders the three tabs. Copy
   summary works offline. Download saves the redacted, curated report as a
   small standalone HTML file: the file to share. The local file holds the
   raw log, so it is not the one to send.

Work, in order:
1. **Report model** in `src/report` (pure): built from `RunAnalysis`. It
   holds the headline, the points of attention per tab, mod groups ranked
   top 10 plus the rest, the Holds with what each spent its time on, raw
   data sections, and redaction. It needs the structured "mods named" field
   on findings and the audit of rule texts (both above). The ranking choices
   follow version 5: measured + likely shown apart, the MM cache under the
   mod that ships the failing patch, informational findings among the mods.
2. **HTML renderer** from the mockup (CSS and render code turned into a
   module), and the Markdown renderer moved onto the same model.
3. **Browser bundle:** core + report + page in one inline script, so the
   file opens from `file://` (module imports from `file://` are blocked).
   Built into the mod's folder as `Report/template.html`.
4. **Mod:** toolbar button, background writer, setting `reportButton`
   (default on) and `reportOnRouteEnd` for the dev route, so automated runs
   produce and archive the HTML.
5. **Validation:** KSP-dev and KSP-scenario through `Invoke-Run.ps1`. The
   page's model is checked against the CLI's on every archived run. Alex
   opens one bench report by hand.

Research before step 4 (`ksp-reference`, done 2026-10-16): how KSP writes
`KSP.log`.
- Writer: `KSPLog` (`Assembly-CSharp/KSPLog.cs`), a `DontDestroyOnLoad`
  singleton, subscribes to `Application.logMessageReceivedThreaded`. In
  `Start()` it opens one `StreamWriter("KSP.log", append: false)`. There is
  no queue, no thread and no lock.
- Flush timing: the writer flushes every ~21 messages. With
  `LOG_INSTANT_FLUSH` (in `settings.cfg`, off by default) it flushes after
  every message. It also flushes at the end of the header and on quit.
  Consequence: the last few messages before the click can be missing, and
  the file can end mid-line. The page treats a trailing partial line as
  incomplete. The mod never changes `LOG_INSTANT_FLUSH` (design rule 1).
- Reading:
  - open with `FileShare.ReadWrite`, because `File.ReadAllText` and
    `File.OpenRead` fail with a sharing violation;
  - read up to the length seen at open time.
  - Not confirmed in code (Mono's `StreamWriter` sharing mode): verify in
    game with one test read.
- Rotation: none. The file is truncated once per launch and never reopened.
  KSP keeps no older logs; `Logs/` belongs to ModuleManager.
- The reader thread must not `Debug.Log`: that would add a second,
  unlocked writer. It logs on the main thread instead.
- Path: the path is relative, so it resolves against the process's working
  directory at `KSPLog.Start()`, not against `KSPUtil.ApplicationRootPath`.
  The two usually match. The exception is a launch with another working
  directory (a shortcut's "Start in", a terminal on Linux or macOS). The mod
  captures `Directory.GetCurrentDirectory()` early (its Instantly addon),
  falls back to `ApplicationRootPath`, and records which one it used.
- Format: one `[LOG|WRN|ERR|ASR|EXC hh:mm:ss.fff]` prefix per message, with
  continuation lines unprefixed. Stack traces appear only on errors and
  exceptions. Timestamps can be UTC when the local time zone throws. On
  Linux and macOS, line endings mix LF and CRLF. The parser must accept
  both.

Decisions (Alex, 2026-10-16):
- **One self-contained HTML file** per report, with the gzipped inputs
  embedded (~2–3 MB on the bench, whose KSP.log is 18.8 MB).
- **No bundler dependency:** our own script in plain JavaScript (`.mjs`, no
  packages) joins tsc's output into the page's one inline script. No
  esbuild. The analyzer stays in TypeScript; TypeScript is a development
  tool only. What the mod ships (the template, its script) is plain
  JavaScript with no TypeScript runtime or dependency.
- **Fonts embedded** in the template (OFL; the license file ships with
  them), so the page looks the same offline.
- **Alpha without Copy link.** It comes back with the hosted page.
- Report writing is on demand only. Writing after every Hold would add disk
  and CPU work while the next Hold is being measured (design rule 1).
- The three choices left open since mockup v1 stay as in version 5.

## Steps

1. Visual mockup from the bench run's real data, published as a private
   artifact, for Alex to review. Not shipped.
2. Mockup version 5 approved for an alpha (2026-10-16). Next: the alpha's
   work list in "Alpha: the mod writes the report", in that order, starting
   with step 1a below.

Step 1a (done 2026-10-16): `Finding.mods`, a list of `ModRef`
(`findings/types.ts`), set by every rule that names a mod.
- Fields: `name` (the assembly when the cost comes from code, else the
  GameData folder), `folder` (when known) and `role`.
- Roles:
  - `culprit`: the cost is this mod's alone;
  - `shared`: several named mods carry it, in unknown parts (patch overhead
    with several owners, MM cache errors in several mods' files);
  - `candidate`: the mod may be the cause (long stall between two mods'
    lines, the buffered switch's patches on KSPCF's settings, a
    ScenarioModule or post-load callback matched by name).
- Never stock KSP, T-Minus, a KSPCF patch name or a file path.
  `subject` stays as the short label.
- Findings with no mod: drag cubes (`related` ties them to the MM cache),
  part compilation, mm-dump, the TechTree case of mm-cold.
- Helpers: `modRef`, `folderRef`, `assemblyRef` and `sharedRole` in
  `core/mods.ts`; `refs` in `findings/places.ts`.
- Consistency check `unlistedMods` (`findings/index.ts`):
  - an installed mod named in a finding's title or action must be in its
    `mods`;
  - file paths, and the mechanism mods (MM, KSPCF, Harmony), are exempt;
  - `check-archived` runs it on every archived run, and tests cover it.
- Text audit (decision 5):
  - the buffered switch's action names the candidate mods instead of "a
    mod's compatibility patch", and separates the case where the profiler
    saw a patch change the key but KSP.log names none;
  - the MM cache action names the mod that ships the failing file;
  - an expensive stock addon says it is stock instead of "report it to the
    authors of Assembly-CSharp".
  - Left as is: mm-cold's TechTree action (KSP.log does not name the
    patch) and part compilation (install-wide by design, folders in the
    evidence).
- Bench run 20261016-103746: 26 of 28 findings name mods, matching
  mockup v5's groups (ResearchBodies and ProgressiveCBMaps under their
  assembly names, with folder REPOSoftTech). 85 tests pass, and the whole
  archive passes `check-archived`.

Next: step 1, the report model in `src/report`, built on `mods`.

## Status

- 2026-10-16: decisions 1–4 taken; measurements done.
- 2026-10-16: mockup v1 published (private artifact
  `https://claude.ai/artifact/Cw6G1z4zHHwmKjMdGGj5Hp`; source in the session
  scratchpad, not in the repo). Proposals in it, open for review:
  - headline: Countdown time plus the largest fixable cost, counting a
    finding together with the ones that follow from it (MM cache 54.1 s +
    drag cubes 22.3 s = ~76 s);
  - three to five points of attention: the actionable ones first (fixable,
    trade-off), then the largest measured mod cost, then the largest likely
    one;
  - mods ranked by measured + likely seconds, shown apart (solid and hatched
    bar) and never added in the text ("3.3 + ~11.8 s");
  - MM cache errors filed under the mod that ships the failing patch
    (ChemicalPropulsion), with drag cubes under it; the buffered switch and
    part compilation in an install-wide group;
  - informational findings (assets, Harmony patching) ranked among the mods,
    with a chip instead of a separate section.
  Next: Alex's review of the mockup.
- 2026-10-16: mockup v2 (same URL) names every mod (decision 5). Alex asked
  for a look closer to KSP than to a generic web report: design proposal v3
  published (private artifact `https://claude.ai/artifact/4b3mJ18QsmmVWwc8JwbDhk`,
  source in the session scratchpad). It borrows the game's UI language, no
  logos or game art: stock-style window panels on a space background, a
  mission clock (`T–04:40`), the VAB's Engineer's Report for the points of
  attention, the staging stack for Countdown phases (stages count down to
  0, the main menu), Resources-panel bars for time by mod, and the Alt+F12
  debug console for technical details. Single dark look, like the game.
- 2026-10-16: Alex asked for two separate parts, startup and scene
  transitions. v3 revised (same URL, version 2): a shared summary window
  with jump links, then Part 1 Startup (its own Engineer's Report, staging
  stack, time by mod counting only startup seconds) and Part 2 Scene
  transitions (its own Engineer's Report, one expandable row per Hold with
  the findings inside it and the unattributed rest, time by mod counting
  only Hold seconds). A finding with time in both parts appears in both,
  each with only its own seconds and an "also N s in ..." note.
  Still open from v1: rank by measured + likely or measured only; MM cache
  error under ChemicalPropulsion or install-wide; informational rows among
  the mods or top 10 with "show all".
- 2026-10-16 (version 3, same URL): headers keep the thematic names with a
  plain gloss, as Alex asked: "Countdown (startup time)" and "Holds (scene
  transitions)", in the jump links, banners, window titles and copied
  summary. Rule for every renderer: a thematic name never appears in a
  header without its gloss.
- 2026-10-16 (version 4, same URL): the two parts are tabs below the
  summary window (Alex: "better as tabs"). Countdown opens by default; a
  bare `#transitions` in the URL opens the Holds tab; arrow keys move
  between tabs. The debug console stays below both. Open question for the
  real page: the share link's fragment carries the report, so the tab
  choice cannot also live in the fragment unless the format reserves room
  for it.
- 2026-10-16 (version 5, same URL), from Alex:
  - Resources tables and the rows inside each Hold show the top 10 by
    impact; a footer counts the rest and opens Raw data. Mods rank purely
    by impact now (install-wide causes no longer sorted last). Wider name
    column for longer mod names.
  - Third tab, **Raw data (profiler + log)**, replaces the debug console:
    every number from the run, organized, not ranked or cut (13,312 rows).
    Groups: Run (input, install, KSPCF settings changed, KSP and MM
    timings), Countdown (phases with log lines, loaders, assets by folder,
    by format and every file, long frames), Holds (transitions, flight
    entry phases, long frames, slowest GameEvent calls), Whole session (each
    profiler aggregate family; the profiler does not split them by scene),
    Findings (each with rule id, cost method and evidence lines). Every
    table sorts, filters and pages; one search box filters all of them.
    Each block is labeled profiler, KSP.log or analyzer.
  - Likely costs show "≈", not "~": in the mono font "~32 s" read as a
    negative number. The copied text summary keeps "~".
  Notes for the real page: raw data is ~770 KB for this run (11,473 asset
  rows), so it exists only when the log is analyzed in the browser, never
  in the share link; a shared report's Raw data tab must say so. Raw data
  is redacted with the same rules as the report (paths start at GameData;
  truncated paths in log excerpts become `<path>`).
  Next: Alex picks a direction.
