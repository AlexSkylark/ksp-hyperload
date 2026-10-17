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

## M6: the self-contained mod (Alex, 2026-10-16)

Alex made this a milestone of its own (design roadmap, M6; the web page
moved to M7). The goal: T-Minus is self-contained. A player installs the
mod and it does everything else, with no Node, no command line, no scripts
and no settings to edit. The alpha below is its first delivery.

### The player's journey (decided, Alex, 2026-10-16)

1. **Install.** CKAN or the release zip, into `GameData/000_TMinus`, with
   HarmonyKSP as a declared dependency. Nothing to configure: the shipped
   `Settings.cfg` defaults are the ones every player runs.
2. **First startup after a mod change.** Installing T-Minus (or any mod)
   invalidates ModuleManager's cache, so that startup is always MM cold and
   its report would blame the install change on the game. The report and
   the main-menu message say so and suggest one restart for a typical
   startup. Research first (`ksp-reference`): what in KSP.log, or in MM's
   cache files, tells a cache rebuilt because the install changed apart
   from a cache that never works (the bench's case), with no mod-specific
   knowledge.
3. **Main menu (end of the Countdown).** A stock `ScreenMessages` line with
   the Countdown time and where to get the report. The button is on the
   stock toolbar, added only after the Countdown has ended (design rule 1).
   (Corrected in step 4: the toolbar exists in the main menu too, so
   T-Minus draws no button of its own.)
4. **Playing.** Every Hold is recorded with no interaction.
5. **Asking for the report.** On click, the mod writes one file per session,
   `PluginData/Reports/tminus-<session start>.html`, overwritten on each
   later click (so it covers the Countdown and every Hold so far), and opens
   it in the default browser. No in-game window in the alpha: a screen
   message says the report opened in the browser (Alt+Tab when the game is
   fullscreen) and where it was saved. Failures show on screen too, never
   only in KSP.log.
6. **Sharing.** The local file holds the raw log, so it is not the file to
   share: Copy summary and Download (redacted HTML) are. The KSP forum and
   Reddit do not take `.html` attachments, so in the alpha the copied
   summary is the way to post there; Copy link returns with the hosted page
   (M7).
7. **Later sessions.** Reports are on demand only. KSP truncates KSP.log at
   every launch, so a session nobody asked a report for is gone; that is
   accepted. Saved reports carry their own inputs, which is enough to come
   back to them. Copying KSP.log at quit was considered and dropped: it only
   helps a player who never clicked, and after a crash `OnApplicationQuit`
   does not run anyway.
8. **Housekeeping.** At startup the mod keeps the last 10 sessions'
   `.jsonl` files and reports and deletes older ones. Uninstalling is
   deleting the folder.

Out of the alpha: in-game toggles for the diagnostic modes
(`addonStartHooks`, `harmonyCallHooks`); the defaults cover the common case.

### Alpha: the mod writes the report (proposal, 2026-10-16)

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
4. **Mod:** the journey above: main-menu button and toolbar button,
   screen messages (Countdown time, report saved, failures, the
   first-startup-after-a-change notice), background writer, retention of 10
   sessions. Setting `reportButton` (default on) and `reportOnRouteEnd` for
   the dev route, so automated runs produce and archive the HTML.
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

M6 scope walked through with Alex (2026-10-16): "The player's journey".
Next: step 1, the report model in `src/report`, built on `mods`.

### Report model: shape and decisions (Alex, 2026-10-16)

Shape: `src/report/model.ts` (`buildReport(a: RunAnalysis): Report`),
`redact.ts`, `wording.ts` (scene names, glosses; shared by renderers),
`raw.ts` (`buildRaw`, kept out of `Report`). `Report` is small and
serializable: run facts, notices, a structured headline, a Countdown part
(seconds and their source, points, mod groups, stages, MM breakdown), a Holds
part (points, mod groups, one row per Hold with its top 10 and unmeasured
rest, flight entries) and the curated findings (evidence ≤ 3 lines of ≤ 160
chars, redacted), referenced by index everywhere else.

Grouping by mod is T-Minus' main feature (Alex). Rules:
- A finding with one `culprit` goes in that mod's group (key `name`,
  `folder` as a note when it differs).
- A finding with several mods (`shared` or `candidate`) gets a group of its
  own, kind `mods` ("A or B" for candidates, "A and B" for shared); its cost
  counts once, in no single mod's total.
- A finding with no mod goes in the group of the finding its `related`
  points to; with no `related`, in an install-wide group of its own.
- Groups rank by measured + likely seconds in the part (Countdown or Holds),
  shown apart and never added in the text. Top 10, then a count and totals
  for the rest. Findings with no number rank after those with one.
- No total across groups. The headline adds a finding to its followers
  (`related`) only when both are measured.
- A Hold's unmeasured rest is the Hold minus its measured costs; likely costs
  show as guesses inside that rest, never subtracted from it.

Decisions:
1. **Plain-language text comes from the rules.** Each rule may set
   `Finding.cause`, a short noun phrase for the headline and the copied
   summary; the rest reuses `title` and `action`. Every text is built from
   the analyzed install's data only: no wording, threshold or choice derived
   from the bench runs (design principle 6).
2. **`Finding.remedy`**: `fix`, `trade-off`, `report` (only the mod's authors
   can change it) or `none` (informational), set by each rule.
3. **Points of attention**, at most 5 per part: the actionable ones (`fix`,
   `trade-off`) first, by cost; then the rest by impact, a measured finding
   going before a likely one when it is at least half its size (a guess
   weighs less than a measurement; the reason goes in the design's
   "Thresholds"); filled up to 3.
4. **Several mods, one group** (see the rules above).
5. **Step 1b, before the model:** `long-stall-by-mod` excludes from its log
   gaps the time covered by the profiler's measured spans, so a likely cost
   never repeats a measured one.
6. **Countdown time without the profiler:** the sum of the KSP.log phases,
   labeled "from the log's first line" (the main menu scene switch leaves
   out the menu's first frame).
7. **Privacy:** redact everything that identifies the player, the machine's
   accounts or the particular install and save: usernames, every path
   outside GameData (and the install root inside it), save and vessel
   names, Kerbal names, Steam or account ids. The report must not tie the
   log to one install or save. Hardware models (CPU, GPU, RAM, the
   FastLoader line) stay: they help the diagnosis. The downloaded file
   carries no Raw data tab; it says so.

Engine change with the model: `findings()` fills `places` from `where` when
a rule leaves it out, so every cost is split by part the same way.
Verified (2026-10-16): they overlap. `part.parse.byMod` times
`PartLoader.ParsePart`, which runs every module's `PartModule.Load`
(`PartParseHook.cs`), so part compilation contains the module Load time
that `expensive-part-modules` charges to mods (on the bench, part of
RocketSoundEnhancement's 17.6 s falls inside the 34 s). Consequences: no
total across groups (above), and the install-wide part compilation group
says that it includes the module costs listed under the mods.

Step 1b, what the data allows (2026-10-16): measured costs (addon Awake,
modules, Harmony, ...) are aggregates with no time interval. The only
per-interval datum is a long frame's `covered` total. The profiler does
keep each frame's top-level hook intervals in memory (`FrameCoverage.Top`)
but writes only their sum, so the analyzer cannot tell which log gap a
measured call fell in. Options, for Alex:
- A (exact): the profiler writes, for long frames only, the covered
  intervals (merged, above a size floor), in the .jsonl and the summary
  (format 4); the analyzer subtracts them from each gap, and caps the rest
  by the uncovered time the floor left out. Profiler change plus
  dev/scenario validation runs.
- B (bound, analyzer only): per long frame, attributed gaps are scaled down
  so their sum never exceeds the frame's uncovered time (frame − covered).
  Removes the overlap that is provable from the totals, not all of it.
- Runs without intervals (older formats, `.jsonl` before A) fall back to B.

On the bench run, a long frame's log gaps exceed its uncovered time by
20.5 s in all (13.2 s in one 29.1 s Countdown frame): overlap the totals
prove. **Alex chose A** (2026-10-16).

Step 1b done (2026-10-16):
- Profiler: for each frame ≥ 500 ms, `FrameCoverage` hands out its covered
  runs (top-level hook calls with holes ≤ 1 ms merged), and those with
  ≥ 50 ms inside hooks are recorded as `frame.covered` spans (`covered` =
  time inside hooks). Summary **format 4** appends up to 20 of them, the
  longest, to the long-frame line: `, runs start+length:inHooks` (seconds).
- Analyzer: `long-stall-by-mod` subtracts each run's overlap with a gap,
  scaled by the run's share inside hooks; gaps left under 0.5 s drop; then
  per frame the silences are capped by the time outside every hook (B), which
  also bounds the runs too short to be recorded. Older runs get B only.
  Evidence says "N s later, M s outside timed hooks" when they differ.
- On the bench run (format 3, so B only): ResearchBodies 32.0 s,
  ProgressiveCBMaps 15.2 s, Scatterer 11.6 s. A's numbers need a new bench run.
- Also done here, from the rule below: `PR_NOTE` removed; the action no
  longer guesses the patch's intent ("the candidate patch comes with X (by its
  folder or its NEEDS) ... ask the authors of X whether it needs it off").
- Validation: `dev-runs/20261016-163107`, `scenario-runs/20261016-163329`
  (format 4, summary findings equal to the .jsonl's); tests 88/88;
  check-archived ok on every archived run.

Step 1 done (2026-10-16): the report model.
- `Finding.cause` (short noun phrase) and `Finding.remedy` (fix, trade-off,
  report, none), set by every rule. The `Cost` comment no longer allows an
  outside figure. `findings()` fills `places` from `where` for a numbered
  cost with one known place. The buffered switch without the profiler is
  placed in "the Holds" (`{ phase: "hold" }` with no label); part
  compilation notes that it includes the module Load time charged to mods.
- `core/identity.ts`: the hardware lines of KSP.log's header plus KSP's
  version (`RunAnalysis.system`, kept), and what identifies the player
  (`RunAnalysis.identifying`, for redaction only). It reads install roots
  from paths that reach GameData, users from `Users`/`home` paths, saves
  from `saves/<name>/`, vessels from `.craft` names and "Switching To
  Vessel", and Kerbals from "Crewmember ..." lines and "<Name> Kerman".
  All of these come from stock line formats.
- `report/redact.ts`: a root followed by GameData becomes `GameData`; any
  other root becomes `<KSP>`; any other absolute path becomes `<path>`.
  Names become `<user>`, `<save>`, `<vessel>` or `<Kerbal>`, and Steam ids
  become `<id>`.
- `report/model.ts` (`buildReport`, `checkReport`), `wording.ts`, and
  `raw.ts` (`buildRaw`: full tables, keys and numbers only, not redacted,
  local page only). Choices made while writing it, beyond the decisions
  above:
  - certainty: a cost is *measured* when its kind is measured and its
    confidence is measured; otherwise it is *likely*. So the `-mm-dump`
    export, the texture cache costs and post-load callbacks show as likely
    (≈): they are estimates from log stamps;
  - a finding with one mod goes in that mod's group even when the role is
    `candidate`; its certainty already says it is a guess;
  - a finding with no number and no single part (KSPCF settings not
    read) appears in both parts;
  - points of attention: `none` findings only fill up to 3. A finding that
    follows another point shows with that point, not as its own point. On
    a tie in impact, the measured finding goes first;
  - the headline's cost is the largest `fix` or `trade-off` finding that
    follows no other finding, plus its followers when all of them are
    measured;
  - `Report` carries no run name (the archive folder) and no profiler
    session id;
  - `REPORT_FORMAT = 1`.
- The likely-cost weight and the report's reading limits are in the
  design's "Thresholds".
- Checks:
  - `checkReport` covers: every finding in one group per part; group
    totals equal the findings' totals; at most 5 points, all inside their
    part; Hold rest within the Hold; evidence limits; no root or
    identifier left after redaction;
  - `check-archived` runs these checks on every archived run;
  - six synthetic tests in `test/report.test.ts`;
  - results: 94/94 tests pass, all 29 archived runs ok.
- Bench run `20261016-103746`:
  - Countdown 280.3 s (profiler);
  - headline: MM cache 54.1 s plus drag cubes 22.3 s = 76.4 s, both under
    ChemicalPropulsion;
  - Countdown points: MM cache, RocketSoundEnhancement's module code
    (17.7 s), ResearchBodies' silences (≈32 s), Kopernicus.Injector's
    Awake, KRASH;
  - Holds points: the buffered switch first (8.4 s, trade-off,
    "KerbalJointReinforcement or Kopernicus or UniversalStorage2"), then
    the silences next to ProgressiveCBMaps, Scatterer and
    ParallaxContinued.
  - Redaction on that log: `<KSP>\saves\<save>\Ships\VAB\/<vessel>.craft`,
    `GameData/QuickMods/...`.

Step 1c done (2026-10-16, Alex: option A): ModuleManager's wait split by
the mod that owns each patch (`findings/mm-patching.ts`,
`mm-patching-by-mod`).
- Mechanism (MM v4.2.3): MM stamps each log line when the patching thread
  creates it, so the dump's stamps time the patches. Each pass logs
  "{pass} pass", each patch "Applying update|copy|delete {patch} to
  {node}" (or "Looping on") before it changes the node. The time from such
  a line to the next, with the patch's WRN/ERR/EXC lines in between, goes
  to the folder that ships the patch, clipped to the main thread's wait
  ("Waited"). A patch that matches nothing logs no line, so its time goes
  to the line before it: the cost is likely, never measured.
- Only on a startup that patched from scratch (no `useCache = True`): a
  cache startup's dump holds an earlier session's patch log.
- `Finding.within`: the id of the finding whose cost already holds this
  one's (`mm-cache-not-saved` when the cache was not saved, else
  `mm-cold-startup`). `findings()` drops a share whose container no rule
  reported.
- In the model, a share's seconds go to a third total, `Totals.within`:
  counted in group ranking, never added to measured or likely, never a
  point, never in the headline, never a Hold cost. `remedy: none`,
  informational, from 1 s.
- `unlistedMods` now treats `_` as part of a word, so a folder such as
  `zFinal_FilterExtensions` no longer reads as naming `FilterExtensions`.
- Bench run `20261016-103746` (54.1 s wait): ChemicalPropulsion 34.5 s,
  UnKerballedStart 9.9 s, zFinal_FilterExtensions 1.4 s, Kopernicus 1.0 s;
  UnKerballedStart becomes a group of its own. 97/97 tests pass, all 29
  archived runs ok.

Step 2 design (approved by Alex, 2026-10-16):
- `report/html.ts`, `renderHtml(r, {raw?})`: pure, escapes everything,
  takes mockup v5's structure only and builds every text from the model's
  fields. `report/style.ts`: the mockup's CSS as a string, without the
  mock note or Copy link; fonts come in step 3. `report/text.ts`: the Copy
  summary, "~" for likely costs, at most 2000 characters (the last points
  are cut when over). `markdown.ts` rewritten on `Report`, plus a
  "Technical details" appendix from the `raw.ts` tables;
  `reportComparison` stays as it is.
- Behavior (tabs, raw sort/filter/paging, copy, download) is step 3
  (`src/page`, DOM). The static HTML works without JS: panels stay visible
  until the script hides them.
- The current Markdown's technical content moves into `raw.ts`: long-frame
  log sources, assets by format and slowest files, the MM breakdown,
  flight entries, every finding's full evidence. The Raw tab gets v5's
  groups (Run, Countdown, Holds, Whole session, Findings).
- Raw data is redacted too (change the "not redacted" comment in `raw.ts`).
- Generated wording, e.g. "About 76 s of the Countdown comes from <cause>,
  in <group>. Holds: 1:33 over 7; Editor → Flight is the slowest at
  38.7 s." Chips: fix → "fixable", trade-off → "trade-off", report →
  "report to its authors", none → "info". Likely costs get a dashed icon
  and "≈". A point's text is the action, plus "Also N s in the Holds
  (scene transitions)" when the finding is in both parts. `within` shares
  show apart, never summed.
- `Stage` gets a kind `stock | mod | wait` (`phases.ts` already labels
  "Waiting for ModuleManager's patching"), so the red stage comes back.
- Top tags: KSP version, assemblies, KSPCF, input level, CPU/GPU/RAM.
- Tests: escaping, each finding in its part's HTML and Markdown, the
  summary length limit. `check-archived` renders HTML, Markdown and text
  and checks that no root survives. The three tests that look for old
  Markdown strings get updated.

Step 2 done (2026-10-16): the renderers on the report model.
- `report/html.ts` (`renderHtml`, `esc`), `report/style.ts` (mockup v5's
  CSS), `report/text.ts` (`renderSummary`, `SUMMARY_LIMIT`), shared
  sentences in `report/sentences.ts` (headline, followers, "also in",
  within, how measured). The page embeds the summary as a JSON script
  block (`id="tminus-summary"`, `<` escaped) for step 3's Copy button.
- `markdown.ts` renders the model plus a "Technical details" appendix
  from `raw.ts` (tables cut at 15 rows, evidence at 12 lines). Its run
  heading is the run folder's name only, redacted: the path could name
  the user.
- The summary keeps only an action's first sentence and a point's
  followers; when over 2000 characters it drops the last point of the
  longer list (Holds first on a tie). Bench run `20261016-103746`: 1869
  characters, 3 + 3 points, "4 more points in the full report".
- Scene and Hold names moved to `core/scenes.ts`; finding titles now say
  "in Editor → Flight" instead of "in Hold EDITOR->FLIGHT" (one
  `whereText` in `core/findings/places.ts`).
- CLI: `analyze --html <file>` writes the page for the first run.
- Tests: escaping (no `</script>` but the summary's own), each finding in
  its part's HTML and Markdown, the summary limit. `check-archived`
  renders all three outputs and checks that no root or redactable string
  survives, and the summary's length: 29/29 runs ok.

Step 3 design (approved by Alex, 2026-10-16):
- **Template** (`Report/template.html`): fonts and CSS, a loading window,
  an empty inputs slot, and one inline script. The mod (step 4) only
  replaces the slot with `<script type="application/json"
  id="tminus-inputs">`: format number, name, `KSP.log` and the `.jsonl`,
  each gzipped and base64. The page decompresses them
  (`DecompressionStream`), runs `buildRun` → `analyzeRun` → `buildReport`
  → `renderHtml` and replaces the document with the result. A failure
  shows on the page with the message to report. Opened empty, the
  template says what it is.
- **Two bundles.** The analyzer (core + report + boot) lives only in the
  template. The behavior (tabs, raw tools, Copy, Download) goes into the
  rendered page. Download saves that page as it was rendered: redacted,
  with fonts and behavior, without the inputs or the analyzer.
- **Our own bundler** (`scripts/build-page.mjs`, no dependency;
  TypeScript 7 has no `outFile`): it walks the imports from an entry in
  tsc's output and wraps each module in its own function in a small
  registry, so equal names in two modules never clash. It rewrites only
  the import and export forms tsc emits and fails on anything else
  (default exports, dynamic imports, cycles, `</script` in the code).
  `src/page` has its own tsconfig with the DOM lib. `core` and `report`
  stay free of DOM and Node.
- **Fonts** (`tools/analyze/fonts`, fetched once by
  `scripts/fetch-fonts.mjs` and committed, with each family's OFL text):
  - Chakra Petch 500/600/700 and Noto Sans 400/600/700, Latin subset;
  - Share Tech Mono whole and unmodified: its license reserves the name
    "Share", and a subset, being a modified version, could not use it;
  - "T-Minus Symbols", a fallback family second in every font stack,
    with only `→≈≥` (Noto Sans Math) and `▸▾▴` (Noto Sans Symbols 2):
    none of the three text families has them all, Noto Sans none.
  About 119 KB of files, ~160 KB as base64.
- **Checks:** `check-archived` runs the analyzer bundle in a Node `vm`
  context that exposes only web APIs, on each archived run's inputs
  gzipped as the mod will, and compares its report and HTML with the
  CLI's. A real browser and the DOM behavior stay Alex's check, starting
  with a page from `scripts/fill-template.mjs <run>`, which fills the
  template the way the mod will.
- Two commits: 3a (bundler, boot, fonts, template, equivalence check),
  3b (behavior). Deploying the template with the mod is step 4.

Step 3a done (2026-10-16):
- `src/page`: `inputs.ts` (the inputs block, format 1, shared by the CLI
  and the page; the mod's C# writer must follow it), `analyzer.ts`
  (gunzip, drop a partial last line, analyze, render), `boot.ts`
  (template side: read the block, render, replace the document; errors
  in the loading window with the issues link and a warning not to attach
  the file), `behavior.ts` (a stub until 3b).
- The page keeps the Raw data tab; Download (`window.tminusDownload`)
  saves the same report without it and says so in a notice, as the
  privacy section decided.
- `core/timeline.ts`: gaps and frame places moved out of `model.ts`,
  which broke an import cycle (model → findings → places → model) that
  the bundler refuses.
- Sizes: `template.html` 415 KB (fonts ~160 KB of it), analyzer bundle
  237 KB. A filled bench page (`bench-runs/20261016-103746`) is ~2 MB.
- Checks: the bundle-versus-CLI comparison in `check-archived` passes on
  all 29 archived runs; `test/page.test.ts` covers the block's round trip,
  the slot, the format check, gunzip with a BOM and the cut last line.
- Dev tool: `node scripts/fill-template.mjs <runDir> <out.html>`.

Step 3b done (2026-10-16, while Alex was away):
- `src/page/behavior.ts`, ported from mockup v5's script, enhancing the
  static page only (without JavaScript every part stays visible and every
  raw row is shown):
  - tabs: click, Left/Right arrows, `#transitions`/`#raw` in the URL;
  - Copy summary: Clipboard API, then a selected text area with
    `execCommand("copy")`, then a notice to select by hand;
  - Download: the shared copy (`window.tminusDownload`, set by the
    template) as `tminus-<session>-shared.html` (`tminusDownloadName`); a
    saved copy re-downloads itself;
  - raw tables: filter over the text columns, sort per column (numbers
    descending first, stable), 25 rows then "Show 50 more"/"Show all";
    one search over every table that opens the sections with matches;
    "Open raw data" buttons under ranked lists open the tab with a search.
- Decided by Claude while Alex was away, 2026-10-16: the mockup's COPY
  LINK button is gone. The share link in the URL fragment was decided
  for the web page (M7); in the alpha the shared file is the Download.
  The hint under the buttons now says what Download leaves out.
- Checked in headless Chrome on the filled bench page (12,493 raw rows,
  36 tables): tabs and keys, paging, sort, filter, search (33 rows for
  "Scatterer"), the raw buttons, the download (245 KB, no raw tab, no
  inputs block), no page errors. Copy falls back to its notice there (no
  clipboard in headless): **Alex to check Copy summary in a real
  browser.**

Step 4 (2026-10-16, while Alex was away): the mod side.
- Research (`ksp-reference`, 2026-10-16), confirmed in code:
  - the stock toolbar (`ApplicationLauncher`) exists in the main menu too
    (`AppScenes.MAINMENU`; KSP-dev's log shows it ready there). This
    corrects the journey's item 3;
  - a mod button, once added, survives scene changes; the launcher fires
    `onGUIApplicationLauncherReady` once per scene, so adding on every
    Ready would duplicate it;
  - `ScreenMessages` drops messages while a scene loads and clears them on
    each scene request;
  - stock opens URLs with `Process.Start`; `Application.OpenURL` with a
    `file:///` URI should open the default browser (to check in game);
  - ModuleManager rewrites `GameData/ModuleManager.ConfigSHA` only after a
    from-scratch patching with no errors, deletes it after errors, and
    leaves it alone when it loads the cache. KSP.log tells the cases apart
    too (`Cache SHA =`, `useCache =`, `Changes :`), which `mm-cold`
    already reads.
- Decided by Claude while Alex was away, 2026-10-16:
  - **One button, the stock toolbar, in every scene including the main
    menu**, added once after the Countdown (no IMGUI button of our own). A
    38×38 icon drawn in code ("T" and a minus sign), so T-Minus
    adds no texture to GameDatabase. The button acts once per click and
    never stays pressed.
  - **First startup after a change** (journey item 2): at the main menu the
    mod checks whether `ModuleManager.ConfigSHA` was written after the
    process started. If so, the Countdown message adds that ModuleManager
    patched from scratch and saved a new cache, so the next startup is the
    typical one. A missing file (errors, or no ModuleManager) or an older one
    says nothing. The report's own explanation stays `mm-cold`'s.
  - **No `reportOnRouteEnd` setting:** the dev route always asks for the
    report at its end through `TMinus.Report.ReportApi` (by reflection;
    the route never depends on T-Minus), without opening the browser, and
    waits for it. `Invoke-Run.ps1` archives it as `report.html`. One setting
    fewer, and every automated run checks the mod's writer.
  - The template is a build product: `npm run build` writes it, with the
    fonts' licenses, to `GameData/000_TMinus/Report/` (gitignored), the
    csproj's deploy and `Invoke-Run.ps1` copy it.
- Code: `src/TMinus/Report/`:
  - `ReportWriter` (worker thread): reads KSP.log and the `.jsonl` with
    shared access, up to their length at open, gzips and base64s them into
    the inputs block (format 1), writes `.tmp` then renames. No Unity and
    no `Debug.Log` on that thread;
  - `ReportService`: screen messages (Countdown time, writing, saved and
    opened, failures), the toolbar button, retention (last 10 sessions'
    `.jsonl` and reports, on a worker thread at the main menu), KSP.log's
    path (the working directory at T-Minus' start when KSP.log is there,
    else the install root; logged);
  - `ReportApi`: the route's entry point.
  - Setting `reportButton` (default on).
- A report written while the player is already in the next Hold reads files
  on a worker thread during it; accepted for the alpha (a click is the
  player's choice, and the thread does no main-thread work).
- Route runs (automated, no click): KSP-dev `dev-runs/20261016-211110`
  wrote `tminus-20261016-210855.html` (565 KB; KSP.log 491 KB, profiler
  records 208 KB) at the route's end; KSP-bench `bench-runs/20261016-212255`
  wrote and archived its own. The button itself, the screen messages and
  the browser opening are visual: listed for Alex below.

Next: step 5 (validation).

**For Alex (visual, step 4):** on KSP-dev, start `KSP_x64.exe` normally (no
`-tminus-route`). At the main menu, check:
1. a screen message "T-Minus: Countdown T–mm:ss. For the report, click the
   T-Minus button on the toolbar." (top center, ~10 s);
2. the T-Minus icon (a "T" with a minus) on the stock toolbar, bottom
   right, in the main menu;
3. a click writes the report: "writing the report…", then the browser
   opens the page, and a message says so; the button does not stay pressed;
4. load a save: the same single button in Space Center, VAB, Flight and
   Tracking Station (no duplicates after scene changes), and clicking there
   writes a new report that includes the Holds so far;
5. the page: tabs, Raw data, and Copy summary in the real browser.
Send back the `[TMinus] Report:` lines of `KSP.log` and any exception near
them.

### Decisions after step 3a (Alex, 2026-10-16)

- **No minification.** The template stays one self-contained HTML file
  with readable scripts: anyone can check that nothing is sent anywhere,
  and an error's stack trace is usable in an issue. Code is ~240 KB of a
  ~2 MB filled page, most of it the embedded log. The `.mjs` scripts are
  build and dev tools and never ship.
- **A guess never sends the player to a mod's authors.** A
  `confidence: "heuristic"` finding (today `long-stall-by-mod`) gets no
  `remedy: "report"`. Its action is an experiment the player can run and
  T-Minus can read: move the mod out of GameData, start again, compare the
  same Countdown or Hold in the new report. Its remedy is `none`, so it
  ranks with the informational findings, which only fill the points of
  attention up to three. Only measured findings ask for a report to the
  authors. Done (2026-10-16): `long-stall-by-mod` and a guessed
  `mm-post-load-callback` (`removalTest` in `findings/places.ts`, warning
  that the folder's other mods and the mods that need it go too);
  `check-archived` fails any heuristic finding with `remedy: "report"`.
  Later: the profiler could name a post-load callback's assembly from the
  loaded type, which would make that finding measured.
- **Measure every coroutine, mods' first** (Alex: the most important ones
  to measure). Assessment below; the design waits for Alex.

### Assessment: measuring every coroutine (2026-10-16)

Why: on bench run `20261016-103746`, `long-stall-by-mod` attributes
79.3 s by guess, among them ResearchBodies 32.0 s (Countdown),
ProgressiveCBMaps 15.2 s (Editor → Flight), Scatterer 11.6 s and
ParallaxContinued 8.6 s over several Holds; the Holds total ~93 s, and
~38 s of that is guessed. These silences are main-thread time outside
every timed hook: mods' coroutine steps, Unity messages (`Update`,
`LateUpdate`, `OnGUI`, `Start`), and engine work (scene and asset
loading, GC). This run had per-addon `Start` off (diagnostic), so part
of it may be `Start`.

What the profiler measures today: chosen stock coroutines (startup loaders
through phases, `SetupDragCubeCoroutine` as a span), and each addon's
`IEnumerator Start()` per step (opt-in). Coroutines a mod starts itself
are not measured.

Facts checked (KSP-dev's assemblies, ILSpy, read only):
- `MonoBehaviour.StartCoroutine(IEnumerator)` is managed: null check,
  type check, then `extern StartCoroutineManaged2`. 56 bytes of IL with
  two throws, far over Mono's inlining limit, so calls from mods go
  through it and a Harmony prefix sees every enumerator started that way,
  its type and its assembly.
- `StartCoroutine(string[, object])` goes native (`StartCoroutineManaged`):
  the enumerator is created natively and a prefix never sees it. The prefix
  still sees the MonoBehaviour and the name, so it can resolve the method
  and its `MoveNext`.
- `yield return <IEnumerator>` (a nested coroutine without
  `StartCoroutine`) is run by Unity's native scheduler and never passes
  through `StartCoroutine`. A postfix on a measured `MoveNext` can see it
  in the enumerator's current value.
- Sampling the main thread from a watchdog thread is out: this Mono's
  `StackTrace(Thread, bool)` throws `NotImplementedException` for another
  thread.
- KSPCF does not patch `StartCoroutine`; it rewrites calls inside its own
  and stock methods (FastLoader's pass-through drives loader enumerators
  by hand; `PQSCoroutineLeak` switches PQS to the string form). Enumerators
  driven by hand never reach `StartCoroutine`.
- Scale: stock KSP has 359 iterator methods and 543 `StartCoroutine` call
  sites (12 by name). A Harmony rebuild costs ~4.4 ms on the bench
  (`TMinus.Profiler`: 127 rebuilds, 564 ms).

Two ways to time a coroutine's steps:
1. **Patch each enumerator type's `MoveNext`**, the first time the
   `StartCoroutine` prefix (or a nested yield, or the string form) shows
   the type. Identity and behavior stay untouched, and enumerators driven
   by hand (FastLoader, mods) are timed too once their type is known.
   Cost: one rebuild per new type, ~4 ms, paid inside the Countdown or Hold
   where the type first appears. Hundreds of types would add a second or
   more, so our own patching time must be recorded and kept out of every
   mod's cost. Patching happens after the owner is instantiated, which
   respects the rule on patching mod code (static constructors).
2. **Wrap the enumerator**: the prefix replaces the argument with our
   wrapper, whose `MoveNext` times the inner one. One patch in total, no
   per-type cost. But Unity now holds a different object: a mod's
   `StopCoroutine(itsEnumerator)` would stop nothing unless
   `StopCoroutine(IEnumerator)` is patched to map it, and any code that
   inspects the running enumerator sees ours. That changes behavior,
   against design rule 1.

Way 1, approved by Alex (2026-10-16), first as a counting-only build;
the hazards kept small:
- read the current value only from compiler-generated iterators (their
  `<>2__current` field), never through a custom enumerator's getter;
- skip generic enumerator types and types whose patch fails, recording the
  skip;
- main thread only;
- a coroutine step's time inside other timed hooks is not counted twice
  (the frame coverage's union already handles nesting; per-mod totals need
  the same care);
- opt-in at first, measured for its own overhead on the bench (Alex's
  runs), then on by default if the overhead is small.

Open before the design:
- how many enumerator types a bench session starts (decides the patching
  cost; a counting-only build answers it with a prefix and no patches);
- whether the frame's uncovered rest shrinks enough: a large rest after
  coroutines points at Unity messages (`Update` and the like) next.

#### Census, counting only (2026-10-16)

`CoroutineCensusHook` (group `coroutineCensus`, off by default): prefixes
on `StartCoroutine(IEnumerator)` and `StartCoroutine(string, object)`,
counts per enumerator type (or behaviour + method name for the string
form), no timing. At each checkpoint it writes `coroutine.start`
aggregates (count only; the analyzer ignores the name) and the counters
`coroutine.types.new`, `.new.generic`, `.new.custom`, `coroutine.byName.new`
and `coroutine.types.seen`.

KSP-scenario run `scenario-runs/20261016-190210` (route: Countdown, Space
Center, Editor, Flight; `check-archived` ok):
- 1837 starts, 78 keys: 76 enumerator types plus 2 by name
  (`PQS.ResetAndWaitCoroutine`, `PQS.UpdateSphere`);
- by assembly: Assembly-CSharp 60, KSPCommunityFixes 11, UnityEngine.UI 2,
  RocketSoundEnhancement 2, KSPAssets 1, ModuleManager 1, TMinusRoute 1;
- 1 generic type (UI `TweenRunner<ColorTween>`, the most started: 284), no
  custom (hand-written) enumerator: every other type is a compiler iterator;
- new types per checkpoint: 2, 19, 7, 10, 2, 10, ... ; most appear early
  in each scene, so lazy patching would put the rebuilds into scene loads;
- largest counts: KSPCF `AudioLoader` 192, RSE `SetupAudioSources` 188,
  `DestructibleBuilding.LoadOnSceneStart` 170.

At ~4.4 ms per Harmony rebuild (bench), 78 types cost ~0.35 s on this
install.

KSP-bench run `bench-runs/20261016-191910` (Alex, standard route,
`coroutineCensus = true`; a diagnostic, its times are not benchmark
results; `check-archived` ok):
- 7245 starts, 152 keys: 145 enumerator types plus 7 by name, from 43
  assemblies (Assembly-CSharp 66, KSPCommunityFixes 11, TrackingStationEvolved
  7, KSPTextureLoader 6, ParallaxContinued 5, scatterer 5, the rest 1–3);
- 3 generic types (UI `TweenRunner<ColorTween>` and KSPTextureLoader's
  `DoLoadTexture<Texture2D>` and `<Texture>`), no custom enumerator;
- new types per checkpoint: 1, 31, 1, 17, 0, 23, 3, 19, 0, 33, 6, ... then
  0 from the second visit of each scene on. Patching every type costs
  ~0.65 s per session, at most ~0.15 s in one scene load;
- largest counts: KSPCF `AudioLoader` 1392, `DestructibleBuilding` 850,
  UI tween 732, HUDReplacer `LoadTexture` 642, `PQSCity.PostSetup` 611,
  Parallax `SetMaterialTexturesAsync` 558.

What it says about the guessed long frames (the same run's
`long-stall-by-mod`):
- ResearchBodies (guessed 32 s in the Countdown): its only coroutine,
  `processMapNodes`, first starts at t = 421 s, long after the Countdown.
  Timing coroutines would not cover that guess: the time is in code started
  some other way (Unity messages such as `Update`, callbacks, or a nested
  iterator yielded without `StartCoroutine`).
- ProgressiveCBMaps (guessed in Editor → Flight): no coroutine started
  through `StartCoroutine` at all. Same conclusion.
- Scatterer, Parallax, Kopernicus and KRASH start coroutines in the scenes
  where their silences are, so timing could cover part of those.

So way 1 is affordable, but on this evidence alone it would not explain
the two largest guesses. The next question is which Unity entry points
hold the uncovered time (see "Open before the design").

Generic types: KSPTextureLoader's are generic over reference types, which
Mono may compile as shared code, so patching one instantiation could
affect the others (not verified). The skip rule above stands, and the skip is recorded, so the
report says those types are not timed.

#### Order decided (Alex, 2026-10-16)

1. `addonStartHooks` on by default, if its overhead is small. It already
   measured `ProgressiveCBMaps.VisualMaps.Start()` at 41.2 s
   (`bench-runs/20261015-041352`), the time `long-stall-by-mod` now guesses.
   Its cost is mostly the lazy Harmony rebuilds of each addon's `Start`
   (that 2026-10-15 run recorded 346 `addon.start` aggregates, before
   Harmony patching was timed). Measuring it: one bench run with
   `-StartHooks` on the current build. The profiler's `harmony.patch`
   records for `TMinus/TMinus.Profiler` after the Countdown are that cost,
   measured directly. A full on/off series only if it is large. Known
   residual difference from vanilla, to state in the design: each addon's
   `Start` is compiled up to one frame earlier.
   **Measured** (2026-10-16, `bench-runs/20261016-193534`, the first
   automated bench run, `addonStartHooks = true`, build `7284dff`): T-Minus's
   Harmony patching took 440 rebuilds and 1261 ms, against 129 and 554 ms
   without the hook (`20261016-191910`). The hook's cost is about **311
   rebuilds, ~0.7 s per session**: +0.16 s at startup (addons created
   before the main menu), then 0.13–0.25 s in each scene's first load and
   under 0.03 s on later visits. Its prefix and postfix run once per addon
   (and once per step of a coroutine `Start`), which is negligible. KSP's
   own markers can't resolve 0.7 s (`Loading Systems` 195.6 s with the
   hook, 198.1 s and 202.1 s in the two runs without it, run-to-run noise).
   What the run measured: `ProgressiveCBMaps.VisualMaps.Start()` 41.1 s in
   the Countdown, the time `long-stall-by-mod` had guessed as ResearchBodies
   (32 s). The guess named the wrong mod in the right folder (both are in
   `REPOSoftTech`, which is what the removal test moves). ProgressiveCBMaps'
   15.3 s in Editor → Flight is still a guess with the hook on: it is not in
   a `Start`.
   Along the way, the analyzer's places now drop one under 0.5 ms, as the
   summary does: a 0.4 ms coroutine step in the Countdown had made the
   .jsonl's FilterExtensions finding session-wide and the summary's not.
   **Done:** on by default (2026-10-16). Design rule 2 now reads "opt-in
   until their cost is measured"; `Prepare-BenchRun.ps1 -StartHooks`
   became `-NoStartHooks`; the expectations' `when.diagnostic` became
   `when.startTimed`; the Start finding lost its "diagnostic mode" note.
   Validated with the new default (build `7dc5744`): `dev-runs/20261016-194425`,
   `scenario-runs/20261016-194645`, `bench-runs/20261016-195421`, all
   `check-archived` ok. The bench run repeats the cost: 440 rebuilds,
   1270 ms (1261 ms in the first run); `VisualMaps.Start()` 41.6 s.
2. Way 1, timing coroutine steps per enumerator type (above). Design
   proposal (2026-10-16, for Alex's review):
   - **Group** `coroutineHooks`, off by default until its cost is measured
     on the bench (design rule 2), then on by default if small. It replaces
     the census (its counts come for free); `coroutineCensus` is removed.
   - **Discovery.** The census's prefix on `StartCoroutine(IEnumerator)`
     sees each enumerator type the first time it starts and patches that
     type's `MoveNext` there, before Unity runs the first step. The type
     has an instance and its code is about to run, so this is as late as a
     patch can be (KCT rule): the method compiles microseconds earlier, not
     a frame. `StartCoroutine(string)` creates the enumerator natively; its
     prefix finds the named method on the behaviour and the iterator type it
     creates (`AccessTools.EnumeratorMoveNext`, compiler iterators only),
     so those 7 bench keys are covered too.
   - **Nested coroutines.** A step that yields an `IEnumerator` hands Unity
     a nested coroutine, which no `StartCoroutine` call shows. The postfix
     reads the step's current value from the compiler's `<>2__current`
     field (compiler iterators only, never a custom getter) and patches a
     new enumerator type it finds there. Unity runs that one's first step
     after the postfix returns, so it is timed too (the proposal said it
     would not be).
   - **Skipped, and recorded as skipped:** generic enumerator types (shared
     code, see above), types whose patch fails, assemblies named
     `UnityEngine*` (engine internals, not KSP or mod work), T-Minus's own,
     and `MoveNext`s another T-Minus hook already patches (`AddonStartHooks`'
     coroutine `Start`s).
   - **Timing.** Prefix and postfix on `MoveNext`, main thread only: one
     aggregate `coroutine.step` per type and checkpoint (steps, total, max).
     A step that throws is lost (record less). Steps are synchronous, so
     they count as covered time for `long-stall-by-mod`.
   - **Steps inside other timed code** (changed in implementation, wider
     than the proposal's "nested in another step"): Unity runs a
     coroutine's first step inside `StartCoroutine`, so a coroutine started
     in a timed `Start`, `OnStart` or event handler has its first step
     inside that call's time. Any step a later-reported timed call
     encloses (`FrameCoverage` sees it: on one thread, a call reported
     later that started earlier contains it) moves to
     `coroutine.step.within` and is never added to a mod's total.
     `TimingAggregate.Add(key, start, end, enclosed)` and `MoveTo` do the
     move; the key's max is left as it was, and a step a checkpoint already
     wrote stays counted (rare).
   - **Self time** (added after the first scenario run, `scenario-runs/20261016-201204`,
     which gave 5 findings instead of 3): a step gives way to every other
     timed call. It records only its own time; the timed calls inside it
     (part parsing, module hooks, events, enumerators driven by hand inside
     it) keep theirs. Before, KSPCF's `PartLoader_CompileAll` step held
     3.6 s that `part.parse` and the module hooks already counted.
   - **Loader coroutines** (same run): a coroutine started on a
     `LoadingSystem` (the loading screen's loaders: KSPCF FastLoader starts
     its `FilesLoader`, `FastAssetLoader` and the loaders' `Load` on
     GameDatabase; MM's `PostPatchLoader` runs `Run()`), and the nested ones
     it yields, go to `coroutine.step.loading`. A loader step runs other
     mods' work (files, parts, configs, MM's post-patch callbacks), so its
     owner is not the mod whose code took the time, and the Countdown's
     stage rules already split that work per mod. It counts as covered time
     but never enters a mod's total. The first run blamed KSPCF for 9.9 s
     and MM for 1.4 s this way. A type is classified when first seen.
   - **Validated** with both fixes (build `dced849.dirty`,
     `coroutineHooks = true`): `scenario-runs/20261016-202258` (3 findings
     again, as without the group; 61 step keys 6.6 s, almost all stock PQS;
     11 within 0.4 s; 10 loader keys 3.5 s, `PartLoader_CompileAll` now
     131 ms of self time instead of 3631 ms, MM's `PostPatchLoader.Run`
     160 ms; 6 types skipped) and `dev-runs/20261016-202538` (0 findings),
     both `check-archived` ok.
   - **Bench** (`bench-runs/20261016-203341`, details in
     `docs/benchmarks/results.md`): 140 types hooked, 12 skipped; patching
     +0.56 s (582 rebuilds, 1832 ms, against 440 and 1270 ms); Countdown
     and Holds the same as with the group off (one run each). New findings:
     ContractConfigurator 7.1 s (`FinalizeContractTypeLoad`) and
     JanitorsCloset 1.0 s; the guessed Parallax long frame in Editor →
     Flight is now covered by measured steps. **On by default since `a5d401c`** (approved by Alex, 2026-10-16), revalidated on dev, scenario and bench (`docs/benchmarks/results.md`, "coroutineHooks on by default").
     The patching cost is close to
     `addonStartHooks`' 0.7 s, and that group went on by default.
   - **Summary format 5:** "coroutine <assembly/type> N ms, N steps" lines,
     top ten per block, and "coroutines <assembly> N ms, N steps" per
     assembly, as modules have.
   - **Analyzer:** `expensive-coroutine` (`core/findings/coroutine-cost.ts`:
     one finding per mod from 1 s, stock and T-Minus left out, its costliest
     types as evidence, places by checkpoint, measured; the enclosed time
     in a note; loader steps never read) and raw tables for the four
     families.
   - **Cost to expect:** ~150 types and their nested ones, ~0.7–1 s of
     patching per session (the census), plus prefix/postfix per step,
     measured on the bench before it goes on by default.
3. Unity messages (`Update` and the like), lazily per type. Research,
   assessment and design proposal below (decided by Claude while Alex was
   away, 2026-10-16).

#### Unity messages: research (2026-10-16)

From the `ksp-reference` agent, checked against the decompiled 1.12.5
sources, KSPCF 1.41.1 and Harmony 2.2.1:

- **No stock dispatcher gives the time per mod type.** `PartModule`,
  `VesselModule` and `ScenarioModule` declare no `Update`, `FixedUpdate`,
  `LateUpdate` or `OnGUI`: a mod's `Update()` on them is a plain Unity
  message. `Part.ModulesOnUpdate`/`ModulesOnFixedUpdate` call the virtual
  `PartModule.OnUpdate`/`OnFixedUpdate` for all of a part's modules in one
  loop, in flight only, after `FlightGlobals.ready` (so mostly after a
  Hold), and give time per part, not per module type. `TimingManager`
  runs each stage's delegates as one multicast call. Per-type patches on
  the methods mods declare are the only way.
- **Harmony catches Unity's native calls.** The detour is a jump written
  at the method's compiled code, so every caller lands on it, Unity's
  message invocation included (as with `Start`). Patching a declared method
  times every subclass that does not override it; an override that calls
  `base.Update()` nests the two.
- **Which method Unity calls:** the most-derived declaration of the
  message name (private ones too), found by walking `BaseType` with
  `DeclaredOnly` (`GetMethod` on a subclass misses a base's private one).
- **KSPCF** patches 13 per-frame messages, all on stock types (bool
  prefixes and full replacements), and walks `TimingManager`'s delegates
  by reflection to clean leaks: never wrap or replace delegates, and never
  patch a stock-declared message (a mod type that inherits one, such as a
  `ModuleCommand` subclass, would time all stock instances and sit on top
  of KSPCF's patch).
- **Where mod behaviours appear with an instance:** `AddonLoader.StartAddon`
  (addons), `PartModule.Awake`, `VesselModule.Awake`, `ScenarioModule.Awake`,
  and any behaviour that calls `StartCoroutine`. During the loading screen
  part prefabs are inactive and their icons are stripped, so part modules
  get no messages there; `VesselModuleManager.CompileModules` creates every
  `VesselModule` type once at load and destroys it at once. Behaviours a mod
  creates itself (`AddComponent` in its code, UI prefabs) appear at none of
  these points.
- **Pitfalls:** abstract methods have no body; methods of generic types
  may share code across closed types on Mono (skip, as coroutines do).

#### Unity messages: assessment and proposal (decided by Claude while Alex was away, 2026-10-16)

Why: the census found that the two largest guessed stalls start no
coroutine where they stall; per-frame messages are the largest family of
mod code T-Minus does not time yet, and the residual of a long frame is
"mods' own Unity messages, coroutines, engine work" (`FrameCoverage`).

- **Group** `unityMessageHooks`, off by default until its cost is measured
  on the bench (design rule 2), then by the `coroutineHooks` criterion:
  on if its patching cost is near theirs (~0.6–0.7 s per session).
- **Messages:** `Update`, `LateUpdate`, `FixedUpdate`, `OnGUI` (no
  parameters). `OnDestroy`, `OnEnable` and the rest are left for later.
- **Discovery, with an instance (KCT rule):** postfixes on
  `AddonLoader.StartAddon` (the addon's type), `PartModule.Awake`,
  `VesselModule.Awake` and `ScenarioModule.Awake` (the instance's type) and
  a prefix on `StartCoroutine(IEnumerator)` (the behaviour's type). Part and
  vessel modules created while the scene is `LOADING` are not discovered
  there: they get no messages then (inactive prefabs, icons, the one-shot
  `VesselModule` instances), so patching them at load would only add
  Countdown time; their first instance in a game scene patches them.
  Behaviours a mod creates without any of these calls are not timed (record
  less); a scan for them is a later option.
- **Only mod code:** the message's most-derived declaration (what Unity
  calls) is patched only when its declaring assembly is one
  `AssemblyLoader` loaded from GameData and not T-Minus. Stock- and
  engine-declared messages are skipped ("stock"), so nothing lands on top of
  KSPCF's patches. Also skipped and counted: abstract or bodiless methods,
  generic declaring types, methods another T-Minus hook already patches,
  failed patches. One patch per method (a base class shared by several
  types is patched once and keyed by its declaring type).
- **Only inside the Countdown and the Holds:** a message runs every frame
  for the whole session, and the report is about loading. A static
  `LoadingWindow` is open from T-Minus' start until the main menu's
  checkpoint, and from each `HighLogic.LoadScene` request until that
  transition's "ready" checkpoint. Outside it the prefix only reads a bool:
  no clock, no record. So every `unity.message` aggregate covers loading
  time only, and the checkpoint places it as other aggregates are placed.
  The first frames after "ready" (hitch watch) are not covered.
- **Timing:** prefix and postfix, main thread, one aggregate
  `unity.message` per method and checkpoint (calls, total, max), self time
  and `unity.message.within` as coroutine steps do
  (`TimingAggregate.Add(key, start, end, enclosed)`), so a base call inside
  an override, or a message driven by hand inside another timed call, is
  never counted twice. Messages count as covered frame time for
  `long-stall-by-mod`.
- **Summary format 6:** "message <assembly/type.method> N ms, N calls" top
  ten per block, "messages <assembly> N ms, N calls" per assembly.
- **Analyzer:** rule `expensive-unity-message` (one finding per mod from
  1 s, measured, stock and T-Minus left out, costliest methods as evidence,
  places by checkpoint) and a raw table, as coroutines have.
- **Cost to expect:** one patch per mod type with a message (likely a few
  hundred on the bench: addons, part modules and their UI behaviours), a
  bool check per call outside loading, and a clock pair per call inside.
  Measured on the bench before the default changes.

#### Unity messages: results and default (decided by Claude while Alex was away, 2026-10-16)

- First scenario run (`scenario-runs/_invalid/20261016-210457`) patched 83
  stock methods: KSP lists its own `Assembly-CSharp` in
  `AssemblyLoader.loadedAssemblies` (as "KSP"), so "loaded from GameData"
  was not enough. `IsModAssembly` now leaves that assembly out by identity.
  Rerun `scenario-runs/20261016-210814`: 13 methods, all mod code; KSP-dev
  `dev-runs/20261016-211110`: none (stock only), check ok on both.
- Bench `bench-runs/20261016-212255`: +309 patches, +0.66 s of T-Minus
  patching per session (results.md). Messages measured: 11.5 s in the
  Countdown, 0.4–2.0 s per Hold; the largest, one mod's loading-screen
  `OnGUI`, 9.4 s over 115,344 calls.
- **Default: on.** The cost meets the criterion set above (near
  `coroutineHooks`' ~0.6 s), and the group found a measured cost that no
  other hook covered. `Settings.cfg` and `ProfilerSettings.OffByDefault`
  changed; revalidation runs on dev, scenario and bench with repo defaults.
- Deferred: messages of behaviours no discovery hook sees (a scan); the
  first frames after "ready"; `OnDestroy`/`OnEnable`.

### Rule: report facts come only from what T-Minus observes (Alex, 2026-10-16)

No information in the report may exist because someone read a particular
mod's source or files. T-Minus is independent and mod-agnostic: it sees only
itself and the DLLs it profiles, through KSP.log and its profiler. Outside
figures are excluded as well.

Audit against it (2026-10-16):
- Profiler and analyzer code name no content mod (the hits are comments and
  format examples).
- Mod names in findings come from the run: assembly names, GameData folders
  of logged file paths, and the `NEEDS[...]` of patch names as
  ModuleManager logs them.
- **Mockup v5 broke the rule**: "ChemicalPropulsion's compatibility patch
  for NearFutureSpacecraft" was read off a file name, and "KSPCF's support
  patch for UniversalStorage2" came from reading the bench's patch files,
  like the table in "Name the patch behind each changed KSPCF setting".
  The real report says only what the rules output.
- To remove: `PR_NOTE` in `buffered-scene-switch.ts`, which quotes KSPCF
  pull request #250's 4–7 s per switch, in a note and in the not-measured
  cost method.
- To reword: "likely turns it off on purpose, for compatibility" in the
  same rule states an intent T-Minus does not observe; say what it does
  observe (a patch that applies only with that mod installed).
- Decided (Alex, 2026-10-16):
  1. ModuleManager, KSPCF and Harmony are the only mods whose internals
     T-Minus may know (besides stock KSP). That knowledge only interprets
     what the log and the profiler show in the analyzed install; it never
     supplies a fact about the install by itself.
  2. The profiler may read KSPCF's patch nodes from the game database at
     runtime (read only): that observes the profiled process.

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
