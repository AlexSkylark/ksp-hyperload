// Findings on small synthetic logs: one test per rule, with the lines each rule
// reads written the way KSP, ModuleManager, KSPCF and the profiler write them.
// Run with: npm --prefix tools/analyze test

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildRun } from "../core/run.js";
import { analyzeRun } from "../core/model.js";
import { folderOfUrl, modOfAssembly, modOfSource } from "../core/mods.js";
import { DECIMAL, decimal } from "../core/log.js";
import { kspcfPatches } from "../core/kspcf.js";
import { reportRun } from "../report/markdown.js";
import type { Finding } from "../core/findings/index.js";

/** A timestamped KSP.log line. */
const L = (time: string, text: string, level = "LOG") => `[${level} ${time}] ${text}`;

const findings = (log: string[], jsonl?: object[]): Finding[] =>
  analyzeRun(buildRun("test", log.join("\n"), jsonl?.map((r) => JSON.stringify(r)).join("\n"))).findings;
const ids = (fs: Finding[]) => fs.map((f) => f.id);

// ModuleManager patching with errors, as dumped into KSP.log.
const MM_COLD = [
  L("10:00:01.000", "[ModuleManager] Waited 60.500s for patching to finish"),
  L("10:00:01.100", "[ModuleManager] Dumping ModuleManager log to main log"),
  L("10:00:01.200", "[ModuleManager] "),
  "#### BEGIN MODULEMANAGER LOG ####",
  L("09:59:00.000", "Applying update SomeMod/Patches/compat/@PART[a]:AFTER[Other] to Other/Parts/a.cfg/PART[a]"),
  L("09:59:00.001", "Cannot find key foo in PART", "WRN"),
  L("09:59:00.002", "Error - Cannot parse variable search when replacing (%) key bar = #$foo$", "ERR"),
  L("09:59:59.000", "Errors in patch prevents the creation of the cache", "WRN"),
  L("09:59:59.100", "ModuleManager: 100 patches applied, found 1 error"),
  "1 error related to GameData/SomeMod/Patches/compat.cfg",
  "",
  L("09:59:59.200", "Done!"),
  "#### END MODULEMANAGER LOG ####",
];

test("MM cache not saved: names the file, measures the wait", () => {
  const [f] = findings(MM_COLD);
  assert.equal(f.id, "mm-cache-not-saved");
  assert.equal(f.subject, "SomeMod");
  assert.match(f.title, /errors in SomeMod\/Patches\/compat\.cfg/);
  assert.deepEqual([f.cost.kind, f.cost.seconds], ["measured", 60.5]);
  assert.ok(f.evidence.some((e) => e.text.startsWith("Applying update SomeMod")), "the patch application before the error");
  assert.ok(f.evidence.some((e) => e.line === 10 && e.text.startsWith("1 error related")), "continuation line, with its line number");
});

test("MM cache not saved: a wait printed with a comma", () => {
  const [f] = findings(MM_COLD.map((l) => l.replace("Waited 60.500s", "Waited 60,500s")));
  assert.equal(f.cost.seconds, 60.5);
});

test("MM cache saved: no finding", () => {
  assert.deepEqual(findings([L("10:00:00.000", "[ModuleManager] Waited 2.000s for patching to finish")]), []);
});

// Drag cubes, two parts 3 s apart, before the main menu.
const DRAG_CUBES = [
  L("10:01:00.000", "[KSPCF/DragCubeGeneration] Creating drag cubes for part 'a'"),
  L("10:01:03.000", "[KSPCF/DragCubeGeneration] Creating drag cubes for part 'b'"),
  L("10:01:04.000", "PartLoader: done"),
  L("10:01:05.000", "[HighLogic]: =========================== Scene Change : From LOADING to MAINMENU (Async) ====================="),
  L("10:02:00.000", "DragCubeSystem: Creating drag cubes for part 'c'"),
];

test("drag cubes: every startup when the MM cache is not saved", () => {
  const f = findings([...MM_COLD, ...DRAG_CUBES]).find((f) => f.id === "drag-cubes-regenerated")!;
  assert.match(f.title, /for 2 parts on every startup/, "the part after the main menu is not counted");
  assert.deepEqual([f.cost.kind, f.cost.seconds], ["estimated", 4]);
  assert.deepEqual(f.related, ["mm-cache-not-saved"]);
});

test("drag cubes: once, without an MM problem, heuristic", () => {
  const [f] = findings(DRAG_CUBES);
  assert.match(f.title, /during this startup/);
  assert.equal(f.confidence, "heuristic");
});

test("drag cubes: a one-off under 1 s is not a finding", () => {
  assert.deepEqual(findings([L("10:01:00.000", "DragCubeSystem: Creating drag cubes for part 'a'"), L("10:01:00.200", "next")]), []);
});

// KSPCF's direct scene switch off through a ModuleManager patch, then two switches, one buffered.
const scene = (time: string, from: string, to: string, async: boolean) =>
  L(time, `[HighLogic]: =========================== Scene Change : From ${from} to ${to}${async ? " (Async) " : " "}=====================`);
const SWITCHES = [scene("10:01:00.000", "MAINMENU", "SPACECENTER", true), scene("10:02:00.000", "SPACECENTER", "TRACKSTATION", false)];
const SYNC_OFF = [
  // MM's patch applications reach KSP.log only inside its dump.
  L("10:00:00.500", "[ModuleManager] "),
  "#### BEGIN MODULEMANAGER LOG ####",
  L("09:59:00.000", "Applying update KSPCommunityFixes/MMPatches/ModSupport/UniversalStorage/@KSP_COMMUNITY_FIXES:NEEDS[UniversalStorage2] to KSPCommunityFixes/Settings.cfg/KSP_COMMUNITY_FIXES"),
  L("09:59:00.001", "Applying update Kopernicus/Config/X/@KSP_COMMUNITY_FIXES:FINAL to KSPCommunityFixes/Settings.cfg/KSP_COMMUNITY_FIXES"),
  "#### END MODULEMANAGER LOG ####",
  L("10:00:01.000", "[KSPCommunityFixes] Patch ForceSyncSceneSwitch not applied (not enabled in Settings.cfg)"),
];

test("buffered scene switch: KSPCF's direct switch off, with the MM patches on its settings as candidates", () => {
  const [f] = findings([...SYNC_OFF, ...SWITCHES]);
  assert.equal(f.id, "buffered-scene-switch");
  assert.equal(f.subject, "ForceSyncSceneSwitch");
  assert.match(f.title, /^1 scene switch used KSP's buffered mode: KSPCommunityFixes' ForceSyncSceneSwitch is not applied \(candidates: UniversalStorage2; Kopernicus\)$/);
  assert.ok(f.notes?.includes("Buffered switches: MAINMENU->SPACECENTER."));
  assert.equal(f.cost.kind, "not-measured");
});

test("buffered scene switch: KSPCF before 1.37 words the settings reason differently", () => {
  const old = SYNC_OFF.map((l) => l.replace("not enabled in Settings.cfg", "disabled in Settings.cfg"));
  assert.deepEqual(ids(findings([...old, ...SWITCHES])), ["buffered-scene-switch"]);
});

test("buffered scene switch: nothing without the effect, or without KSPCF's line", () => {
  assert.deepEqual(findings([...SYNC_OFF, SWITCHES[1]]), [], "no buffered switch happened");
  assert.deepEqual(findings(SWITCHES), [], "stock, or a KSPCF without this patch: nothing to say about KSPCF");
  const applied = L("10:00:01.000", "[KSPCommunityFixes] Patch ForceSyncSceneSwitch applied.");
  assert.deepEqual(findings([applied, ...SWITCHES]), [], "applied (a buffered line would come from the mission builder)");
});

test("buffered scene switch: other reasons come from KSPCF's line, without candidates", () => {
  const [f] = findings([L("10:00:01.000", "[KSPCommunityFixes] Patch ForceSyncSceneSwitch not applied, error applying patch", "ERR"), ...SWITCHES]);
  assert.match(f.action, /^KSPCommunityFixes failed to apply it/);
  assert.doesNotMatch(f.title, /candidates/);
});

test("KSPCF: patch lines are read by their structure, unknown forms are left out", () => {
  const run = buildRun("t", [
    L("10:00:00.000", "[KSPCommunityFixes] Patch A applied."),
    L("10:00:00.001", "[KSPCommunityFixes] Patch B not applied (disabled in Settings.cfg)"),
    L("10:00:00.002", "[KSPCommunityFixes] Patch C not applied (Breaking Grounds DLC not installed)"),
    L("10:00:00.003", "[KSPCommunityFixes] Patch D isn't applicable to this KSP version."),
    L("10:00:00.004", "[KSPCommunityFixes] Patch E not applied : System.Exception: boom"),
    L("10:00:00.005", "[KSPCommunityFixes] Patch F did something new"),
  ].join("\n"));
  const states = [...kspcfPatches(run.log).values()].map((p) => `${p.name}:${p.state}`);
  assert.deepEqual(states, ["A:applied", "B:off-in-settings", "C:not-applicable", "D:wrong-ksp-version", "E:error"]);
});

// Two mods installed, one Hold into flight with a 3 s silence after SlowMod's line.
const HOLD = [
  L("10:00:00.000", "Load(Assembly): SlowMod/Plugins/SlowMod"),
  L("10:00:00.001", "Load(Assembly): Squad/Plugins/KSPSteamCtrlr"),
  L("10:05:00.000", "[HighLogic]: =========================== Scene Change : From EDITOR to FLIGHT (Async) ====================="),
  L("10:05:01.000", "[SlowMod] building things"),
  L("10:05:04.000", "[UIMasterController]: HideUI"),
  L("10:05:04.500", "[UIMasterController]: something"),
  L("10:05:07.500", "[UIMasterController]: ShowUI"),
];

test("long stall, KSP.log only: attributed to the mod next to the gap", () => {
  const fs = findings(HOLD);
  assert.deepEqual(ids(fs), ["long-stall-by-mod"], "the stock-only gap is not attributed");
  assert.match(fs[0].title, /Long stall in Hold EDITOR->FLIGHT attributed to SlowMod/);
  assert.deepEqual([fs[0].cost.seconds, fs[0].confidence], [3, "heuristic"]);
});

test("mods: sources match installed assemblies, not stock or T-Minus", () => {
  const run = buildRun("t", [
    L("10:00:00.000", "Load(Assembly): REPOSoftTech/ResearchBodies/Plugins/ProgressiveCBMaps"),
    L("10:00:00.001", "Load(Assembly): ParallaxContinued/ParallaxContinued"),
    L("10:00:00.002", "Load(Assembly): KSPTextureLoader/KSPTextureLoader"),
    L("10:00:00.003", "Load(Assembly): KSPTextureLoader/KSPTextureLoader.Burst"),
    L("10:00:00.004", "Load(Assembly): 000_TMinus/Plugins/TMinus"),
  ].join("\n"));
  assert.equal(modOfSource(run, "ProgressiveCBMaps-EVEWrapper")?.name, "ProgressiveCBMaps (REPOSoftTech)");
  assert.equal(modOfSource(run, "Parallax")?.name, "ParallaxContinued");
  assert.equal(modOfSource(run, "KSPTextureLoader")?.name, "KSPTextureLoader");
  assert.equal(modOfSource(run, "TMinus"), undefined);
  assert.equal(modOfSource(run, "UIMasterController"), undefined);
  // Assemblies (profiler keys) match exactly: no prefix guessing.
  assert.equal(modOfAssembly(run, "ProgressiveCBMaps")?.folder, "REPOSoftTech");
  assert.equal(modOfAssembly(run, "KSPTextureLoader.Burst")?.name, "KSPTextureLoader.Burst (KSPTextureLoader)");
  assert.equal(modOfAssembly(run, "Parallax"), undefined);
  assert.equal(modOfAssembly(run, "TMinus"), undefined);
});

test("mods: the GameData folder of a URL or path", () => {
  assert.equal(folderOfUrl("SomeMod/Patches/compat.cfg"), "SomeMod");
  assert.equal(folderOfUrl("GameData/SomeMod/Patches/compat.cfg"), "SomeMod");
  assert.equal(folderOfUrl(String.raw`C:\KSP\GameData\SomeMod\Parts\a.cfg`), "SomeMod");
  assert.equal(folderOfUrl("Squad"), "Squad");
});

test("numbers: both decimal separators", () => {
  assert.equal(decimal("88.662"), 88.662);
  assert.equal(decimal("88,662"), 88.662);
  assert.equal(decimal("12"), 12);
  assert.match("88,662", new RegExp(`^${DECIMAL}$`));
  assert.match("88.662", new RegExp(`^${DECIMAL}$`));
});

// A profiled run: the profiler starts 10 s after the process, at the "loaded" line.
const PROFILED_LOG = [L("10:00:00.000", "[TMinus] T-Minus 0.1.0+test loaded"), L("10:00:00.001", "Load(Assembly): SlowMod/Plugins/SlowMod")];
const header = { kind: "run", profilerStartMs: 10000, uptimeAtProcessStartMs: 0 };
const menu = { t: 100000, kind: "span", name: "scene.transition", detail: "LOADING->MAINMENU", dur: 20000 };
const checkpoint = (t: number) => ({ t, kind: "mark", name: "checkpoint" });
const aggregate = (t: number, name: string, detail: string, total: number, count = 1) => ({ t, kind: "aggregate", name, detail, total, count });

test("profiler rules run only with the profiler's .jsonl", () => {
  const log = PROFILED_LOG;
  const records = [header, menu, checkpoint(50000), aggregate(50000, "addon.awake", "SlowMod/SlowMod.Startup", 1500)];
  assert.deepEqual(ids(findings(log, records)), ["expensive-addon"]);
  const logOnly = analyzeRun(buildRun("t", log.join("\n")));
  assert.deepEqual(ids(logOnly.findings), []);
  assert.equal(logOnly.input.level, "log");
  assert.ok(logOnly.input.missing.some((m) => m.startsWith("expensive addons")), "says what the profiler would add");
});

test("expensive addon: placed in the Countdown or a Hold by its checkpoint", () => {
  const hold = { t: 200000, kind: "span", name: "scene.transition", detail: "MAINMENU->SPACECENTER", dur: 10000 };
  // The profiler always checkpoints when the main menu is ready (end of the Countdown).
  const records = [header, menu, hold, checkpoint(50000), checkpoint(120000), checkpoint(205000), aggregate(205000, "addon.awake", "SlowMod/SlowMod.Scene", 2000), aggregate(205000, "addon.awake", "SlowMod/SlowMod.Small", 999)];
  const fs = findings(PROFILED_LOG, records);
  assert.equal(fs.length, 1, "under 1 s is not a finding");
  assert.match(fs[0].title, /Expensive addon Awake: SlowMod\.Scene \(SlowMod\) in Hold MAINMENU->SPACECENTER/);
  assert.deepEqual([fs[0].cost.kind, fs[0].cost.seconds], ["measured", 2]);
});

test("expensive addon: named by the GameData folder its assembly loads from", () => {
  const log = [L("10:00:00.000", "[TMinus] T-Minus 0.1.0+test loaded"), L("10:00:00.001", "Load(Assembly): SlowPack/Plugins/SlowMod")];
  const [f] = findings(log, [header, menu, checkpoint(50000), aggregate(50000, "addon.awake", "SlowMod/SlowMod.Startup", 1500)]);
  assert.equal(f.subject, "SlowMod (SlowPack)");
  assert.match(f.title, /SlowMod\.Startup \(SlowMod in SlowPack\)/);
});

test("expensive addon over several places: cost by place, largest first, and in the report", () => {
  const hold = { t: 200000, kind: "span", name: "scene.transition", detail: "MAINMENU->SPACECENTER", dur: 10000 };
  const records = [header, menu, hold, checkpoint(50000), aggregate(50000, "addon.awake", "SlowMod/SlowMod.Both", 600), checkpoint(120000), checkpoint(205000), aggregate(205000, "addon.awake", "SlowMod/SlowMod.Both", 1400)];
  const a = analyzeRun(buildRun("t", PROFILED_LOG.join("\n"), records.map((r) => JSON.stringify(r)).join("\n")));
  const [f] = a.findings;
  assert.equal(f.where.phase, "session");
  assert.deepEqual(f.places, [
    { where: { phase: "hold", hold: "MAINMENU->SPACECENTER" }, seconds: 1.4 },
    { where: { phase: "countdown" }, seconds: 0.6 },
  ]);
  assert.ok(reportRun(a).includes("- By place: Hold MAINMENU->SPACECENTER 1.4 s; the Countdown 0.6 s."));
});

test("long frame with the profiler: the main menu stall is in the Countdown", () => {
  // Process start = 10:00:00 - 10 s. A 30 s frame from t = 95 s (10:01:25) covers a 25 s gap after SlowMod's line.
  const log = [...PROFILED_LOG, L("10:01:26.000", "[SlowMod] start"), L("10:01:51.000", "[UIApp] next")];
  const frame = { t: 95000, kind: "span", name: "frame.long", detail: "MAINMENU", dur: 30000 };
  const [f] = findings(log, [header, menu, frame]);
  assert.match(f.title, /Long frame in the Countdown attributed to SlowMod/);
  assert.equal(f.cost.seconds, 25);
});

test("long frame with the profiler: time outside every hook is reported", () => {
  const log = [...PROFILED_LOG, L("10:01:26.000", "[SlowMod] start"), L("10:01:51.000", "[UIApp] next")];
  const frame = { t: 95000, kind: "span", name: "frame.long", detail: "MAINMENU", dur: 30000, covered: 4000 };
  const a = analyzeRun(buildRun("test", log.join("\n"), [header, menu, frame].map((r) => JSON.stringify(r)).join("\n")));
  assert.equal(a.longFrames?.[0].coveredSeconds, 4);
  assert.ok(reportRun(a).includes("Timed hooks cover 4.0 s of the frame; 26.0 s is outside every hook."));
});

test("part compilation: informational, ranked last, none for stock only", () => {
  const records = [header, aggregate(1000, "part.parse.byMod", "Squad", 5000, 300), aggregate(1000, "part.parse.byMod", "SlowMod", 2000, 50)];
  const fs = findings([...PROFILED_LOG, ...MM_COLD], records);
  assert.deepEqual(ids(fs), ["mm-cache-not-saved", "part-parsing-by-mod"]);
  assert.ok(fs[1].informational);
  assert.match(fs[1].title, /350 parts from 2 folders/);
  assert.deepEqual(findings(PROFILED_LOG, [header, aggregate(1000, "part.parse.byMod", "Squad", 5000, 300)]), []);
});

// The profiler's summary in KSP.log: process start at 10:00:00.000 (the opening line, at 10:04:22, says it is 262 s in).
const SUMMARY = [
  L("10:00:00.500", "[TMinus] T-Minus 0.1.0+test loaded"),
  L("10:00:00.600", "Load(Assembly): SlowMod/Plugins/SlowMod"),
  L("10:03:25.000", "[SlowMod] building the menu"),
  L("10:03:55.000", "[UIApp] next"),
  L("10:04:21.900", "[TMinus] Profiler: main menu ready 261.9 s after process start | loaders: GameDatabase >=16.7 s~, PartLoader 4.0 s, KISAddonConfig+KISConfigLoader 0.0 s (~ = accurate to a frame, >= = started before T-Minus)"),
  L("10:04:22.000", "[TMinus] Summary (format 1): Countdown ready at 261.930 s (main menu scene 57.28 s), this line at 262.000 s after process start"),
  L("10:04:22.001", "[TMinus] Summary: long frame MAINMENU at 204.000 s, 48.000 s"),
  L("10:04:22.002", "[TMinus] Summary: addon Awake SlowMod/SlowMod.Startup 4580 ms, 1 call"),
  L("10:04:22.003", "[TMinus] Summary: addon Awake (other 37) 2110 ms, 61 calls"),
  L("10:04:22.004", "[TMinus] Summary: parts SlowMod 3604 ms, 162 parts"),
  L("10:04:22.005", "[TMinus] Summary: parts Squad 6843 ms, 364 parts"),
  L("10:04:22.006", "[TMinus] Summary: end | 1 long frame 48.0 s, addon Awake 6.7 s, parts 10.4 s"),
  L("10:06:00.000", "[TMinus] Summary (format 1): Hold MAINMENU->SPACECENTER 15.81 s, ready at 360.000 s, this line at 360.000 s after process start"),
  L("10:06:00.001", "[TMinus] Summary: addon Start SlowMod/SlowMod.Scene 1500 ms, 2 calls"),
  L("10:06:00.002", "[TMinus] Summary: end | addon Start 1.5 s"),
];

test("summary in KSP.log: profiler rules run from it, and the report says so", () => {
  const a = analyzeRun(buildRun("t", SUMMARY.join("\n")));
  assert.equal(a.input.level, "log+summary");
  assert.ok(a.input.missing.some((m) => m.startsWith("every addon")), "says what the full .jsonl adds");
  assert.deepEqual(a.countdown.mainMenu?.seconds, 57.28);
  assert.deepEqual(a.holds.map((h) => h.label), ["MAINMENU->SPACECENTER"]);
  assert.deepEqual(a.countdown.loaders, [
    { name: "GameDatabase", approx: true, seconds: 16.7 },
    { name: "PartLoader", approx: false, seconds: 4 },
    { name: "KISAddonConfig+KISConfigLoader", approx: false, seconds: 0 },
  ]);

  const stall = a.findings.find((f) => f.id === "long-stall-by-mod")!;
  assert.match(stall.title, /Long frame in the Countdown attributed to SlowMod/, "frame placed by the anchor from the opening line");
  assert.equal(stall.cost.seconds, 30);

  const addons = a.findings.filter((f) => f.id === "expensive-addon").map((f) => f.title);
  assert.deepEqual(addons.sort(), [
    "Expensive addon Awake: SlowMod.Startup (SlowMod) in the Countdown",
    "Expensive addon Start: SlowMod.Scene (SlowMod) in Hold MAINMENU->SPACECENTER",
  ]);
  assert.ok(a.findings.some((f) => f.id === "part-parsing-by-mod" && /526 parts from 2 folders/.test(f.title)));
});

test("summary: the .jsonl wins when both are there", () => {
  const run = buildRun("t", SUMMARY.join("\n"), JSON.stringify({ kind: "run", profilerStartMs: 500, uptimeAtProcessStartMs: 0 }));
  assert.equal(run.recordsFrom, "jsonl");
  assert.equal(analyzeRun(run).input.level, "log+profiler");
});

test("buffered scene switch with the profiler: measured per buffered Hold", () => {
  const hold = (t: number, detail: string, dur: number) => ({ t, kind: "span", name: "scene.transition", detail, dur });
  const step = (t: number, dur: number) => ({ t, kind: "span", name: "scene.bufferedLoad.step", dur, steps: 1 });
  const overlay = (t: number, detail: string, value: number) => ({ t, kind: "counter", name: "scene.overlayAfterGuiReady", detail, value });
  const log = [...PROFILED_LOG, ...SYNC_OFF, ...SWITCHES, scene("10:03:00.000", "TRACKSTATION", "FLIGHT", true)];
  const records = [
    header, menu,
    hold(200000, "MAINMENU->SPACECENTER", 10000), step(201000, 800), step(202000, 400), overlay(210000, "MAINMENU->SPACECENTER", 2000),
    // Direct switch: its overlay is not the buffered mode's cost.
    hold(300000, "SPACECENTER->TRACKSTATION", 1000), overlay(301000, "SPACECENTER->TRACKSTATION", 500),
    // Flight waits for its vessel either way: steps only.
    hold(400000, "TRACKSTATION->FLIGHT", 8000), step(401000, 300), overlay(408000, "TRACKSTATION->FLIGHT", 1000),
  ];
  const f = findings(log, records).find((f) => f.id === "buffered-scene-switch")!;
  assert.equal(f.cost.kind, "measured");
  assert.ok(Math.abs(f.cost.seconds! - 3.5) < 1e-9, String(f.cost.seconds));
  assert.deepEqual(f.places?.map((p) => [p.where.hold, p.seconds]), [["MAINMENU->SPACECENTER", 3.2], ["TRACKSTATION->FLIGHT", 0.3]]);
  assert.ok(f.evidence.some((e) => e.text.endsWith("overlay after GUI ready not counted (a direct switch waits too)")));
});

test("buffered scene switch without the profiler: not measured", () => {
  const [f] = findings([...SYNC_OFF, ...SWITCHES]);
  assert.equal(f.cost.kind, "not-measured");
});

test("drag cubes with the .jsonl: the profiler's span is the measured cost", () => {
  const span = aggregate(50000, "partLoader.methods", "DragCubeSystem.SetupDragCubeCoroutine(Part) span", 2500, 3);
  const f = findings([...PROFILED_LOG, ...DRAG_CUBES], [header, menu, span]).find((f) => f.id === "drag-cubes-regenerated")!;
  assert.match(f.title, /for 2 parts/, "the count comes from the log");
  assert.deepEqual([f.cost.kind, f.cost.seconds], ["measured", 2.5]);
  assert.match(f.notes![0], /timed 3 parts and KSP.log shows 2 generated/);
});

test("expensive ScenarioModule: per module, by Hold, the mod guessed by name", () => {
  const hold = { t: 200000, kind: "span", name: "scene.transition", detail: "MAINMENU->SPACECENTER", dur: 10000 };
  const records = [
    header, menu, hold, checkpoint(120000), checkpoint(205000),
    aggregate(205000, "scenario.load", "SlowModScenario", 1200, 1),
    aggregate(205000, "scenario.load", "ResearchAndDevelopment", 300, 1),
    aggregate(205000, "scenario.load", "(other modules)", 5000, 40),
  ];
  const fs = findings(PROFILED_LOG, records);
  assert.deepEqual(ids(fs), ["expensive-scenario-module"]);
  assert.equal(fs[0].title, "Expensive ScenarioModule: SlowModScenario (likely SlowMod) in Hold MAINMENU->SPACECENTER");
  assert.deepEqual([fs[0].cost.kind, fs[0].cost.seconds], ["measured", 1.2]);
});

test("asset loading by mod: mod folders over 1 s, informational, from KSP.log alone", () => {
  const log = [
    L("10:00:01.000", "Load(Texture): Squad/Parts/big"),
    L("10:00:04.000", "Load(Texture): SlowMod/Parts/a"),
    L("10:00:05.000", "Load(Texture): SlowMod/Parts/b"),
    L("10:00:05.600", "Load(Model): SmallMod/Parts/m"),
    L("10:00:05.900", "Load(Texture): 000_TMinus/icon"),
    L("10:00:07.900", "Loading Asset Bundle Definitions"),
  ];
  const fs = findings(log);
  assert.deepEqual(ids(fs), ["asset-loading-by-mod"], "stock, T-Minus and small folders are left out");
  const [f] = fs;
  assert.equal(f.title, "Asset loading: SlowMod takes 1.6 s of the Countdown (2 files)");
  assert.ok(f.informational);
  assert.equal(f.confidence, "heuristic");
  assert.equal(f.evidence[0].line, 2, "slowest file first");
  assert.doesNotMatch(f.notes!.join(" "), /PNG/, "stock lines do not name the format");
});

test("asset loading by mod: FastLoader's PNG textures are named in a note", () => {
  const log = [
    L("10:00:00.000", "[KSPCF] Injecting FastLoader..."),
    L("10:00:01.000", "Load PNG texture: SlowMod/Parts/a"),
    L("10:00:02.200", "Load DDS texture: SlowMod/Parts/b"),
    L("10:00:02.500", "Loading Asset Bundle Definitions"),
  ];
  const [f] = findings(log);
  assert.match(f.notes!.join(" "), /1\.2 s is PNG or JPG textures/);
});
