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
import { unlistedMods, type Finding } from "../core/findings/index.js";
import { addPlace, ranked } from "../core/findings/places.js";
import type { Place } from "../core/findings/types.js";

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

// A cold startup whose patching ends inside the main thread's 10 s wait (09:59:51 to 10:00:01).
const MM_PATCHING = [
  L("10:00:01.000", "[ModuleManager] Waited 10.000s for patching to finish"),
  L("10:00:01.200", "[ModuleManager] "),
  "#### BEGIN MODULEMANAGER LOG ####",
  L("09:59:40.000", ":FOR[SLOW] pass"),
  L("09:59:41.000", "Applying update Slow/Patches/a/@PART[*] to Squad/Parts/p.cfg/PART[p]"),
  L("09:59:53.000", "Applying update Slow/Patches/a/@PART[*] to Squad/Parts/q.cfg/PART[q]"),
  L("09:59:55.000", "Cannot find key foo in PART", "WRN"),
  L("09:59:57.000", "Applying copy Quick/Patches/b/+PART[p] to Squad/Parts/p.cfg/PART[p]"),
  L("09:59:57.500", ":FINAL pass"),
  L("09:59:58.000", "Applying delete Other/x/!PART[q] to Squad/Parts/q.cfg/PART[q]"),
  L("09:59:59.500", "Done patching"),
  L("10:00:00.900", "Ran in 21.000s"),
  "#### END MODULEMANAGER LOG ####",
];

test("MM patching by mod: each folder's time inside the wait, as a share of the cold startup's cost", () => {
  // mm-cold-startup needs its cache-check line inside the dump.
  const log = [...MM_PATCHING];
  log.splice(3, 0, L("09:59:30.000", "SHA generated in 0.100s"));
  const fs = findings(log);
  const shares = fs.filter((f) => f.id === "mm-patching-by-mod");
  // Slow: 09:59:51 to :53 (clipped to the wait) plus :53 to :57 with its warning; Quick 0.5 s is under 1 s; Other 1.5 s.
  assert.deepEqual(shares.map((f) => [f.subject, f.cost.seconds]), [["Slow", 6], ["Other", 1.5]]);
  assert.ok(shares.every((f) => f.within === "mm-cold-startup" && f.cost.kind === "estimated" && f.informational));
  assert.match(shares[0].cost.method, /each of its 2 patch lines/);
  assert.ok(fs.some((f) => f.id === "mm-cold-startup"));
});

test("MM patching by mod: nothing without a finding on the wait it shares", () => {
  assert.deepEqual(ids(findings(MM_PATCHING)), []);
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
  assert.deepEqual(f.mods, [{ name: "UniversalStorage2", role: "candidate" }, { name: "Kopernicus", role: "candidate" }]);
  assert.match(f.action, /The candidate patches come with UniversalStorage2 and Kopernicus \(by their folder or their NEEDS\)/);
  assert.doesNotMatch(f.action, /on purpose|compatibility/, "no guess at the patch author's intent");
});

test("buffered scene switch: one candidate is named in the action", () => {
  const [f] = findings([...SYNC_OFF.filter((l) => !l.includes("Kopernicus")), ...SWITCHES]);
  assert.match(f.action, /The candidate patch comes with UniversalStorage2 \(by its folder or its NEEDS\).*ask the authors of UniversalStorage2 whether it needs ForceSyncSceneSwitch off/);
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
  assert.match(fs[0].title, /Long stall in Editor → Flight attributed to SlowMod/);
  assert.deepEqual([fs[0].cost.seconds, fs[0].confidence], [3, "heuristic"]);
  assert.deepEqual(fs[0].mods, [{ name: "SlowMod", folder: "SlowMod", role: "culprit" }]);
  assert.equal(fs[0].remedy, "none", "a guess never asks for a report to the mod's authors");
  assert.match(fs[0].action, /move SlowMod out of GameData, start the game and compare Editor → Flight in the new report/);
});

test("long stall between two mods: both named, as candidates", () => {
  const log = [L("09:59:59.000", "Load(Assembly): OtherMod/OtherMod"), ...HOLD.flatMap((l) => (l.includes("HideUI") ? [L("10:05:04.000", "[OtherMod] done"), l] : [l]))];
  const [f] = findings(log);
  assert.equal(f.subject, "SlowMod or OtherMod");
  assert.deepEqual(f.mods?.map((m) => [m.name, m.role]), [["SlowMod", "candidate"], ["OtherMod", "candidate"]]);
});

test("unlisted mods: a mod named in a finding's text but missing from its mods is caught, file paths aside", () => {
  const run = buildRun("test", HOLD.join("\n"));
  const base = { id: "x", where: { phase: "countdown" as const }, cost: { kind: "not-measured" as const, method: "" }, evidence: [], cause: "", remedy: "none" as const, confidence: "measured" as const };
  assert.deepEqual(unlistedMods(run, { ...base, title: "SlowMod is slow", action: "" }), ["SlowMod"]);
  assert.deepEqual(unlistedMods(run, { ...base, title: "SlowMod is slow", action: "", mods: [{ name: "SlowMod", role: "culprit" }] }), []);
  assert.deepEqual(unlistedMods(run, { ...base, title: "errors in Other/Patches/SlowMod.cfg", action: "" }), []);
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
  assert.match(fs[0].title, /Expensive addon Awake: SlowMod\.Scene \(SlowMod\) in Main menu → Space Center/);
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
  const md = reportRun(a).join("\n");
  assert.ok(md.includes("  - By place: Main menu → Space Center 1.4 s."), "the Holds part names its Hold");
  assert.ok(md.includes("  - Also 0.6 s in the Countdown (startup time)."), "and the Countdown's share");
});

test("long frame with the profiler: the main menu stall is in the Countdown", () => {
  // Process start = 10:00:00 - 10 s. A 30 s frame from t = 95 s (10:01:25) covers a 25 s gap after SlowMod's line.
  const log = [...PROFILED_LOG, L("10:01:26.000", "[SlowMod] start"), L("10:01:51.000", "[UIApp] next")];
  const frame = { t: 95000, kind: "span", name: "frame.long", detail: "MAINMENU", dur: 30000 };
  const [f] = findings(log, [header, menu, frame]);
  assert.match(f.title, /Long frame in the Countdown attributed to SlowMod/);
  assert.equal(f.cost.seconds, 25);
});

test("long frame with the profiler: time measured by hooks is left out of the silence", () => {
  const log = [...PROFILED_LOG, L("10:01:26.000", "[SlowMod] start"), L("10:01:51.000", "[UIApp] next")];
  const frame = { t: 95000, kind: "span", name: "frame.long", detail: "MAINMENU", dur: 30000, covered: 12000 };
  // The gap is t = 96–121 s. A fully covered 8 s run inside it, and a half-covered 4 s run (119–123 s) with 2 s inside it.
  const runs = [
    { t: 109000, kind: "span", name: "frame.covered", detail: "MAINMENU", dur: 8000, covered: 8000 },
    { t: 119000, kind: "span", name: "frame.covered", detail: "MAINMENU", dur: 4000, covered: 2000 },
  ];
  const [f] = findings(log, [header, menu, frame, ...runs]);
  assert.equal(f.cost.seconds, 25 - 8 - 1);
  assert.match(f.cost.method!, /less the time timed hooks measured/);
  assert.ok(f.evidence.some((e) => e.text.startsWith("[25.0 s later, 16.0 s outside timed hooks]")));
});

test("long frame with the profiler: without runs, the silence is capped by the time outside hooks", () => {
  const log = [...PROFILED_LOG, L("10:01:26.000", "[SlowMod] start"), L("10:01:51.000", "[UIApp] next")];
  const frame = { t: 95000, kind: "span", name: "frame.long", detail: "MAINMENU", dur: 30000, covered: 20000 };
  const [f] = findings(log, [header, menu, frame]);
  assert.equal(f.cost.seconds, 10);
});

test("long frame with the profiler: time outside every hook is reported", () => {
  const log = [...PROFILED_LOG, L("10:01:26.000", "[SlowMod] start"), L("10:01:51.000", "[UIApp] next")];
  const frame = { t: 95000, kind: "span", name: "frame.long", detail: "MAINMENU", dur: 30000, covered: 4000 };
  const a = analyzeRun(buildRun("test", log.join("\n"), [header, menu, frame].map((r) => JSON.stringify(r)).join("\n")));
  assert.equal(a.longFrames?.[0].coveredSeconds, 4);
  assert.match(reportRun(a).join("\n"), /\| Main menu \| [^|]+ \| 30\.00 s \| [\d.]+ s \| 4\.00 s \|/, "the frame and its timed hooks, in the technical details");
});

test("part compilation: informational, ranked last, none for stock only", () => {
  const records = [header, aggregate(1000, "part.parse.byMod", "Squad", 5000, 300), aggregate(1000, "part.parse.byMod", "SlowMod", 2000, 50)];
  const fs = findings([...PROFILED_LOG, ...MM_COLD], records);
  assert.deepEqual(ids(fs), ["mm-cache-not-saved", "mm-patching-by-mod", "part-parsing-by-mod"]);
  assert.ok(fs[2].informational);
  assert.match(fs[2].title, /350 parts from 2 folders/);
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
    "Expensive addon Start: SlowMod.Scene (SlowMod) in Main menu → Space Center",
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
  assert.equal(fs[0].title, "Expensive ScenarioModule: SlowModScenario (likely SlowMod) in Main menu → Space Center");
  assert.deepEqual([fs[0].cost.kind, fs[0].cost.seconds], ["measured", 1.2]);
});

test("expensive ScenarioModule: with the assembly in the key, the mod is known and stock is named", () => {
  const hold = { t: 200000, kind: "span", name: "scene.transition", detail: "MAINMENU->SPACECENTER", dur: 10000 };
  const records = [
    header, menu, hold, checkpoint(120000), checkpoint(205000),
    aggregate(205000, "scenario.load", "SlowMod/SlowMod.Persistence", 1200, 1),
    aggregate(205000, "scenario.load", "Assembly-CSharp/ResearchAndDevelopment", 1500, 1),
  ];
  const fs = findings(PROFILED_LOG, records).filter((f) => f.id === "expensive-scenario-module");
  assert.deepEqual(fs.map((f) => [f.title, f.subject]), [
    ["Expensive ScenarioModule: ResearchAndDevelopment (stock) in Main menu → Space Center", "stock KSP"],
    ["Expensive ScenarioModule: SlowMod.Persistence (SlowMod) in Main menu → Space Center", "SlowMod"],
  ]);
  assert.ok(fs.every((f) => !f.notes!.some((n) => /matched by the module/.test(n))), "no guess when the assembly is known");
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
  const f = findings(log).find((f) => f.id === "asset-loading-by-mod")!;
  assert.match(f.notes!.join(" "), /1\.2 s is PNG or JPG textures/);
});

// Step 6c: rules on module and Harmony records.
const HOLD_SC = { t: 200000, kind: "span", name: "scene.transition", detail: "MAINMENU->SPACECENTER", dur: 10000 };

test("expensive part modules: per mod over the stages, stock and small mods left out", () => {
  const records = [
    header, menu, HOLD_SC, checkpoint(120000), checkpoint(205000),
    aggregate(120000, "module.load", "SlowMod/SlowMod.ModuleA", 600, 500),
    aggregate(205000, "module.onStart", "SlowMod/SlowMod.ModuleA", 300, 500),
    aggregate(205000, "vesselModule.start", "SlowMod/SlowMod.VesselB", 200, 3),
    aggregate(205000, "module.load", "Assembly-CSharp/ModuleEngines", 5000, 900),
    aggregate(205000, "module.awake", "OtherMod/OtherMod.Small", 400, 10),
    aggregate(205000, "module.load", "(other 40 keys)", 3000, 100),
  ];
  const fs = findings(PROFILED_LOG, records).filter((f) => f.id === "expensive-part-modules");
  assert.equal(fs.length, 1, "stock ModuleEngines and OtherMod's 0.4 s give nothing");
  assert.equal(fs[0].subject, "SlowMod");
  assert.deepEqual([fs[0].cost.kind, fs[0].cost.seconds], ["measured", 1.1]);
  assert.deepEqual(fs[0].places!.map((p) => [p.where.phase, Math.round(p.seconds * 10) / 10]), [["countdown", 0.6], ["hold", 0.5]]);
  assert.equal(fs[0].evidence[0].text, "SlowMod.ModuleA: 900 ms over 1000 calls (Load 600 ms, OnStart 300 ms)");
});

test("expensive part modules from the summary: per-assembly totals, per-type evidence", () => {
  const records = [
    header, menu, checkpoint(120000),
    aggregate(120000, "module.byType", "SlowMod/SlowMod.ModuleA", 700, 500),
    aggregate(120000, "module.byAssembly", "SlowMod", 1300, 900),
    aggregate(120000, "module.byAssembly", "Assembly-CSharp", 4000, 900),
  ];
  const [f] = findings(PROFILED_LOG, records).filter((f) => f.id === "expensive-part-modules");
  assert.equal(f.cost.seconds, 1.3, "the assembly total counts types beyond the top ten");
  assert.equal(f.evidence[0].text, "SlowMod.ModuleA: 700 ms over 500 calls");
});

test("expensive coroutines: per mod, steps inside other timed code and loader steps not added, stock left out", () => {
  const records = [
    header, menu, HOLD_SC, checkpoint(120000), checkpoint(205000),
    aggregate(120000, "coroutine.step", "SlowMod/SlowMod.Loader+<LoadAll>d__12", 700, 40),
    aggregate(205000, "coroutine.step", "SlowMod/SlowMod.Loader+<LoadAll>d__12", 200, 10),
    aggregate(205000, "coroutine.step", "SlowMod/SlowMod.Custom", 150, 5),
    aggregate(205000, "coroutine.step.within", "SlowMod/SlowMod.Loader+<Init>d__3", 5000, 1),
    aggregate(205000, "coroutine.step", "Assembly-CSharp/PartLoader+<CompileAll>d__50", 9000, 900),
    aggregate(205000, "coroutine.step.within", "OtherMod/OtherMod.Boot+<Run>d__1", 3000, 1),
    aggregate(205000, "coroutine.step.loading", "KSPCommunityFixes/KSPCommunityFixes.Performance.KSPCFFastLoader+<FilesLoader>d__1", 3700, 400),
    aggregate(205000, "coroutine.step", "(other 40 keys)", 3000, 100),
  ];
  const fs = findings(PROFILED_LOG, records).filter((f) => f.id === "expensive-coroutine");
  assert.equal(fs.length, 1, "stock PartLoader, loader steps and OtherMod's enclosed steps give nothing");
  assert.equal(fs[0].subject, "SlowMod");
  assert.deepEqual([fs[0].cost.kind, fs[0].cost.seconds], ["measured", 1.05]);
  assert.deepEqual(fs[0].places!.map((p) => [p.where.phase, Math.round(p.seconds * 100) / 100]), [["countdown", 0.7], ["hold", 0.35]]);
  assert.deepEqual(fs[0].evidence.map((e) => e.text), ["SlowMod.Loader.LoadAll: 900 ms over 50 steps", "SlowMod.Custom: 150 ms over 5 steps"]);
  assert.ok(fs[0].notes?.some((n) => n.startsWith("Not counted: 5000 ms")));
});

test("expensive coroutines from the summary: per-assembly totals, per-type evidence", () => {
  const records = [
    header, menu, checkpoint(120000),
    aggregate(120000, "coroutine.step", "SlowMod/SlowMod.Loader+<LoadAll>d__12", 700, 40),
    aggregate(120000, "coroutine.byAssembly", "SlowMod", 1200, 90),
  ];
  const [f] = findings(PROFILED_LOG, records).filter((f) => f.id === "expensive-coroutine");
  assert.equal(f.cost.seconds, 1.2, "the assembly total counts types beyond the top ten");
  assert.equal(f.evidence[0].text, "SlowMod.Loader.LoadAll: 700 ms over 40 steps");
});

test("expensive Unity messages: per mod, enclosed calls not added, stock left out", () => {
  const records = [
    header, menu, HOLD_SC, checkpoint(120000), checkpoint(205000),
    aggregate(120000, "unity.message", "SlowMod/SlowMod.Hud.OnGUI", 600, 3000),
    aggregate(205000, "unity.message", "SlowMod/SlowMod.Hud.OnGUI", 300, 1500),
    aggregate(205000, "unity.message", "SlowMod/SlowMod.Tracker.Update", 250, 700),
    aggregate(205000, "unity.message.within", "SlowMod/SlowMod.Base.Update", 4000, 10),
    aggregate(205000, "unity.message", "OtherMod/OtherMod.Thing.Update", 900, 10),
    aggregate(205000, "unity.message", "Assembly-CSharp/FlightIntegrator.Update", 5000, 10),
    aggregate(205000, "unity.message", "(other 40 keys)", 3000, 100),
  ];
  const fs = findings(PROFILED_LOG, records).filter((f) => f.id === "expensive-unity-message");
  assert.equal(fs.length, 1, "OtherMod under 1 s, stock and the (other) line give nothing");
  assert.equal(fs[0].subject, "SlowMod");
  assert.deepEqual([fs[0].cost.kind, fs[0].cost.seconds], ["measured", 1.15]);
  assert.deepEqual(fs[0].places!.map((p) => [p.where.phase, Math.round(p.seconds * 100) / 100]), [["countdown", 0.6], ["hold", 0.55]]);
  assert.deepEqual(fs[0].evidence.map((e) => e.text), ["SlowMod.Hud.OnGUI: 900 ms over 4500 calls", "SlowMod.Tracker.Update: 250 ms over 700 calls"]);
  assert.ok(fs[0].notes?.some((n) => n.startsWith("Not counted: 4000 ms")));
});

test("expensive Unity messages from the summary: per-assembly totals", () => {
  const records = [
    header, menu, checkpoint(120000),
    aggregate(120000, "unity.message", "SlowMod/SlowMod.Hud.OnGUI", 700, 40),
    aggregate(120000, "unity.message.byAssembly", "SlowMod", 1300, 90),
  ];
  const [f] = findings(PROFILED_LOG, records).filter((f) => f.id === "expensive-unity-message");
  assert.equal(f.cost.seconds, 1.3, "the assembly total counts methods beyond the top ten");
  assert.equal(f.evidence[0].text, "SlowMod.Hud.OnGUI: 700 ms over 40 calls");
});

test("Harmony patching: per owner mod, informational, T-Minus left out", () => {
  const records = [
    header, menu, checkpoint(120000),
    aggregate(120000, "harmony.patch", "SlowMod/com.slowmod", 1400, 300),
    aggregate(120000, "harmony.unpatch", "SlowMod/com.slowmod", 100, 4),
    aggregate(120000, "harmony.patch", "TMinus/TMinus.Profiler", 2000, 120),
  ];
  const fs = findings(PROFILED_LOG, records).filter((f) => f.id === "harmony-patching-cost");
  assert.deepEqual(fs.map((f) => [f.subject, f.cost.seconds, f.informational]), [["SlowMod", 1.5, true]]);
  assert.equal(fs[0].evidence[0].text, "Harmony id com.slowmod: 1500 ms, 300 patch calls, 4 unpatch calls");
  assert.match(fs[0].action, /not a fault/);
});

test("patch call overhead: net of calibration, owners from the bracket mark", () => {
  const records = [
    header, menu, checkpoint(120000),
    { t: 50000, kind: "counter", name: "harmony.call.calibration.patches", value: 50 },
    { t: 60000, kind: "mark", name: "harmony.call.bracket", detail: "Assembly-CSharp/Part.FindModelTransform: SlowMod/com.slowmod" },
    { t: 61000, kind: "mark", name: "harmony.call.bracket", detail: "Assembly-CSharp/PQS.BuildTangents: com.slowmod" },
    aggregate(120000, "harmony.patch", "SlowMod/com.slowmod", 10, 2),
    // 20 M calls × 50 ns = 1000 ms of brackets: 1500 ms net.
    aggregate(120000, "harmony.call.patches", "Assembly-CSharp/Part.FindModelTransform", 2500, 20_000_000),
    aggregate(120000, "harmony.call.body", "Assembly-CSharp/Part.FindModelTransform", 4000, 20_000_000),
    // 1.2 s raw but 0.6 s net: nothing.
    aggregate(120000, "harmony.call.patches", "Assembly-CSharp/PQS.BuildTangents", 1200, 12_000_000),
  ];
  const fs = findings(PROFILED_LOG, records).filter((f) => f.id === "patch-call-overhead");
  assert.equal(fs.length, 1);
  assert.equal(fs[0].title, "Patch overhead: SlowMod adds 1.5 s to Part.FindModelTransform (20000000 calls)");
  assert.equal(fs[0].cost.seconds, 1.5);
  assert.match(fs[0].notes![0], /^75 ns per call, after subtracting the brackets' own 50.0 ns/);
});

test("patch call overhead: an owner known by Harmony id only gets its assembly from the patching records", () => {
  const records = [
    header, menu, checkpoint(120000),
    { t: 61000, kind: "mark", name: "harmony.call.bracket", detail: "Assembly-CSharp/PQS.BuildTangents: com.slowmod,com.unknown" },
    aggregate(120000, "harmony.patch", "SlowMod/com.slowmod", 10, 2),
    aggregate(120000, "harmony.call.patches", "Assembly-CSharp/PQS.BuildTangents", 2000, 1000),
  ];
  const [f] = findings(PROFILED_LOG, records).filter((f) => f.id === "patch-call-overhead");
  assert.equal(f.subject, "SlowMod, com.unknown");
  assert.ok(f.notes!.some((n) => /cannot be split/.test(n)));
});

// ModuleManager's dump for a startup without errors, before its cache check's lines.
const mmDump = (check: string[], waited = "12.000") => [
  L("10:00:01.000", `[ModuleManager] Waited ${waited}s for patching to finish`),
  L("10:00:01.200", "[ModuleManager] "),
  "#### BEGIN MODULEMANAGER LOG ####",
  L("09:59:00.000", "Checking Cache"),
  L("09:59:00.300", "SHA generated in 0.300s"),
  L("09:59:00.300", "      SHA = AA-BB"),
  ...check,
  L("09:59:10.000", "Saving Cache"),
  L("09:59:10.100", "ModuleManager: 100 patches applied"),
  "#### END MODULEMANAGER LOG ####",
];
const cold = (fs: Finding[]) => fs.find((f) => f.id === "mm-cold-startup");

test("MM cold startup: config files changed, informational, names the folder", () => {
  const f = cold(findings(mmDump([L("09:59:00.301", "Changes :"), "Added   : NewMod/Patches/a.cfg", "Changed : NewMod/b.cfg.cfg", L("09:59:00.302", "Cache SHA = CC-DD"), L("09:59:00.302", "useCache = False")])))!;
  assert.match(f.title, /config files changed \(1 changed, 1 added\)/);
  assert.equal(f.subject, "NewMod");
  assert.ok(f.informational);
  assert.deepEqual([f.cost.kind, f.cost.seconds], ["measured", 12]);
});

test("MM cold startup: the reason from the cache check's lines", () => {
  const reason = (check: string[]) => cold(findings(mmDump(check)))!.title;
  assert.match(reason([]), /no usable cache/);
  assert.match(reason([L("09:59:00.302", "Cache SHA = CC-DD"), L("09:59:00.302", "useCache = False")]), /set of DLLs/);
  assert.match(reason([L("09:59:00.302", "Cache SHA = AA-BB"), L("09:59:00.302", "useCache = False")]), /does not tell which/);
  assert.match(reason([L("09:59:00.302", "Exception in IsCacheUpToDate: System.NullReferenceException", "EXC")]), /threw an exception/);
});

test("MM cold startup: no TechTree node makes every startup cold, even with a short wait", () => {
  const f = cold(findings(mmDump([L("09:59:09.000", "No TechTree node found. No custom TechTree will be saved")], "0.200")))!;
  assert.match(f.title, /every startup/);
  assert.ok(!f.informational);
});

test("MM cold startup: none with the cache used, a short wait, or errors", () => {
  assert.equal(cold(findings(mmDump([L("09:59:00.302", "Cache SHA = AA-BB"), L("09:59:00.302", "useCache = True")]))), undefined);
  assert.equal(cold(findings(mmDump([], "0.000"))), undefined);
  assert.deepEqual(ids(findings(MM_COLD)), ["mm-cache-not-saved", "mm-patching-by-mod"]);
});

test("MM cache not saved: a failed write, exceptions and the applied share", () => {
  const dump = mmDump([L("09:59:10.050", "Exception while saving the cache: System.IO.IOException: disk full", "EXC"), L("09:59:10.060", "An error occured while creating the cache. Deleting the cache files to avoid keeping a bad cache", "ERR")]);
  const [f] = findings(dump.map((l) => l.replace("100 patches applied", "100 patches applied (97 %), encountered <color=red>2 exceptions</color>")));
  assert.equal(f.id, "mm-cache-not-saved");
  assert.match(f.title, /could not write its cache/);
  assert.match(f.action, /writable/);
  assert.ok(f.notes!.some((n) => /2 exceptions/.test(n)) && f.notes!.some((n) => /97 %/.test(n)));
});

// MM's post-load callbacks: one static (assembly SlowMod), one instance (type SlowModLoader), one quick.
const POST_LOAD = [
  L("10:00:00.100", "Load(Assembly): SlowMod/Plugins/SlowMod"),
  L("10:00:10.000", "[ModuleManager] Running post patch callbacks"),
  L("10:00:11.000", "[ModuleManager] Calling SlowMod.Config.ModuleManagerPostLoad()"),
  L("10:00:12.000", "[SlowMod] reading configs"),
  L("10:00:13.500", "[ModuleManager] Calling Quick.Thing.ModuleManagerPostLoad()"),
  L("10:00:13.600", "[ModuleManager] Calling SlowModLoader.ModuleManagerPostLoad()"),
  L("10:00:14.600", "[ModuleManager] Post patch ran in 4.600s"),
  L("10:05:00.000", "[ModuleManager] Calling Quick.Thing.ModuleManagerPostLoad()"),
  L("10:05:09.000", "[ModuleManager] Post patch ran in 9.000s"),
];

test("MM post-load callbacks: per mod, until MM's next line, this startup only", () => {
  const fs = findings(POST_LOAD).filter((f) => f.id === "mm-post-load-callback");
  assert.deepEqual(fs.map((f) => [f.subject, f.cost.seconds]), [["SlowMod", 3.5]]);
  assert.equal(fs[0].confidence, "heuristic", "the instance callback's owner is guessed from its type name");
  assert.equal(fs[0].remedy, "none", "a guess never asks for a report to the mod's authors");
  assert.match(fs[0].action, /move SlowMod out of GameData/);
});

test("MM post-load callbacks: a static one alone is measured", () => {
  const [f] = findings(POST_LOAD.filter((l) => !l.includes("SlowModLoader")));
  assert.deepEqual([f.cost.seconds, f.confidence, f.remedy], [2.5, "measured", "report"]);
});

test("MM failed: the patching thread threw", () => {
  const [f] = findings([L("10:00:05.000", "[ModuleManager] The patching thread threw an exception: System.Exception: boom", "EXC"), "  at ModuleManager.MMPatchLoader.Run ()"]);
  assert.equal(f.id, "mm-patching-failed");
  assert.match(f.title, /patching thread threw/);
  assert.match(f.evidence[0].text, /MMPatchLoader\.Run/);
});

test("MM dump: -mm-dump on the command line, cost from the Exporting lines", () => {
  const log = [
    L("10:00:00.100", ""), "Environment Info", "Win32NT 7FFFFFFFFFFFFFFF  Args: KSP_x64.exe -mm-dump",
    L("10:00:10.000", "[ModuleManager] Calling NoIVA.ModuleManagerPostLoad()"),
    L("10:00:10.100", "[ModuleManager] Exporting Squad/Parts/a.cfg"),
    L("10:00:12.100", "[ModuleManager] Exporting Squad/Parts/b.cfg"),
    L("10:00:13.100", "[ModuleManager] Post patch ran in 5.000s"),
  ];
  const [f] = findings(log);
  assert.equal(f.id, "mm-dump-every-startup");
  assert.deepEqual([f.cost.kind, f.cost.seconds], ["estimated", 3]);
  assert.match(f.evidence[0].text, /-mm-dump/);
  assert.deepEqual(f.notes, []);
});

// KSPCF's patch lines when its settings were not read: every keyed patch off.
const kspcfLines = (off: number, applied: number) => [
  L("10:00:00.200", "Config(KSP_COMMUNITY_FIXES) KSPCommunityFixes/Settings/KSP_COMMUNITY_FIXES"),
  L("10:00:00.201", "Config(KSP_COMMUNITY_FIXES) OtherMod/KSPCF/KSP_COMMUNITY_FIXES"),
  ...Array.from({ length: off }, (_, i) => L("10:00:01.000", `[KSPCommunityFixes] Patch Fix${i} not applied (not enabled in Settings.cfg)`)),
  ...Array.from({ length: applied }, (_, i) => L("10:00:01.000", `[KSPCommunityFixes] Patch Always${i} applied.`)),
];
const conditions = (extra: object) => ({ kind: "conditions", mmCache: "warm", kspcfSettingsChanged: [], ...extra });

test("KSPCF settings not read: KSP.log's signature names the second node's folder, heuristic", () => {
  const f = findings(kspcfLines(30, 2)).find((f) => f.id === "kspcf-settings-not-read")!;
  assert.equal(f.subject, "OtherMod");
  assert.equal(f.confidence, "heuristic");
  assert.ok(f.evidence.some((e) => e.text.includes("OtherMod/KSPCF")));
});

test("KSPCF settings not read: the profiler's node count is measured, and wins over the signature", () => {
  const counted = findings([...PROFILED_LOG, ...kspcfLines(1, 100)], [header, menu, conditions({ kspcfSettingsNodes: 2 })]);
  const f = counted.find((f) => f.id === "kspcf-settings-not-read")!;
  assert.equal(f.confidence, "measured");
  assert.match(f.title, /2 KSP_COMMUNITY_FIXES nodes/);
  const one = findings([...PROFILED_LOG, ...kspcfLines(30, 2)], [header, menu, conditions({})]);
  assert.ok(!ids(one).includes("kspcf-settings-not-read"), "one node: everything off by hand");
});

test("KSPCF settings not read: a normal install is not the signature", () => {
  assert.ok(!ids(findings(kspcfLines(12, 100))).includes("kspcf-settings-not-read"));
  assert.ok(!ids(findings(kspcfLines(10, 0))).includes("kspcf-settings-not-read"), "too few patch lines to tell");
});

test("buffered scene switch: the profiler names the patch's change to the setting", () => {
  const log = [...PROFILED_LOG, ...SYNC_OFF, ...SWITCHES];
  const [f] = findings(log, [header, menu, conditions({ kspcfSettingsChanged: ["ForceSyncSceneSwitch: true -> false"] })]).filter((f) => f.id === "buffered-scene-switch");
  assert.ok(f.notes?.some((n) => n.includes("ForceSyncSceneSwitch: true -> false")));
  assert.match(f.title, /candidates: UniversalStorage2; Kopernicus/);
});

test("buffered scene switch: off in the installed settings, no patch changed it", () => {
  const log = [...PROFILED_LOG, ...SYNC_OFF, ...SWITCHES];
  const [f] = findings(log, [header, menu, conditions({ kspcfSettingsChanged: ["OtherKey: false -> true"] })]).filter((f) => f.id === "buffered-scene-switch");
  assert.doesNotMatch(f.title, /candidates/);
  assert.match(f.action, /turn ForceSyncSceneSwitch on there/);
});

// FastLoader's PNG lines: a cache hit, a conversion, a file not eligible.
const png = (time: string, url: string) => L(time, `Load PNG texture: ${url}`);
const converted = (time: string, url: string) => L(time, `[KSPCF] PNG texture '${url}' was converted to DXT5 and has been cached for future reloads`);
const notEligible = (time: string) => L(time, "Texture isn't eligible for DXT compression, width and height must be multiples of 4", "WRN");
const ASSETS_END = L("10:00:30.000", "[KSPCF:FastLoader] done");

test("KSPCF texture cache rebuilt: whole cache, informational, cost from the converted files", () => {
  const log = [png("10:00:10.000", "A/a"), converted("10:00:11.000", "A/a"), png("10:00:11.000", "A/b"), converted("10:00:11.500", "A/b"), png("10:00:11.500", "A/c"), notEligible("10:00:11.600"), ASSETS_END];
  const f = findings(log).find((f) => f.id === "kspcf-texture-cache-rebuilt")!;
  assert.match(f.title, /rebuilt its PNG texture cache: 2 textures converted/);
  assert.equal(f.cost.seconds, 1.5);
  assert.equal(f.informational, true);
  assert.ok(!ids(findings(log)).includes("kspcf-texture-cache-off"));
});

test("KSPCF texture cache rebuilt: a few new files with hits is under the threshold", () => {
  const log = [L("10:00:10.000", "Load Cached PNG Texture: A/a"), png("10:00:10.100", "A/b"), converted("10:00:10.200", "A/b"), ASSETS_END];
  assert.ok(!ids(findings(log)).some((id) => id.startsWith("kspcf-texture-cache")));
});

test("KSPCF texture cache off: eligible PNG loads with no hit and no conversion", () => {
  const log = [png("10:00:10.000", "A/a"), png("10:00:11.000", "A/b"), png("10:00:12.000", "A/c"), notEligible("10:00:12.100"), L("10:00:12.200", "[KSPCF:FastLoader] done")];
  const f = findings(log).find((f) => f.id === "kspcf-texture-cache-off")!;
  assert.equal(f.cost.seconds, 2, "A/a and A/b; A/c is not eligible");
  assert.equal(f.confidence, "heuristic");
});

// A Countdown with every phase line, KSPCF's FastLoader and ModuleManager.
const COUNTDOWN = [
  L("10:00:00.000", "******* Log Initiated for Kerbal Space Program - 1.12.5.3190"),
  L("10:00:05.000", "Load(Assembly): ModuleManager.4.2.3"),
  L("10:00:05.500", "[ModuleManager] Patching started on a new thread, all output will be directed to x"),
  L("10:00:06.000", "Load(Assembly): SlowMod/Plugins/SlowMod"),
  L("10:00:16.000", "Load DDS texture: SlowMod/a"),
  L("10:00:30.000", "Loading Asset Bundle Definitions"),
  L("10:00:31.000", "GameDatabase: Assets loaded in 26.000s"),
  L("10:00:42.000", "[ModuleManager] Waited 10.000s for patching to finish"),
  L("10:00:42.500", "[ModuleManager] "),
  "#### BEGIN MODULEMANAGER LOG ####",
  L("10:00:08.000", "Checking Cache"),
  L("10:00:41.900", "Ran in 33.900s"),
  "#### END MODULEMANAGER LOG ####",
  L("10:00:45.000", "[ModuleManager] Post patch ran in 3.000s"),
  L("10:00:45.000", "PartLoader: Compiling Part 'SlowMod/Parts/a/a'"),
  L("10:00:55.000", "PartLoader: Compiling Internal Space 'Squad/Spaces/x'"),
  L("10:00:56.000", "Something after the parts"),
  L("10:00:58.000", "Loading Systems: Elapsed time is 58s"),
  L("10:01:05.000", "[HighLogic]: =========================== Scene Change : From LOADING to MAINMENU ====="),
  L("10:01:09.000", "[ModuleManager] Total loading Time = 63.500s"),
];

test("phases from KSP.log: each phase ends at its line; MM's wait starts before its line", () => {
  const a = analyzeRun(buildRun("t", COUNTDOWN.join("\n")));
  assert.deepEqual(a.countdown.phases!.map((p) => [p.label.split(/[ ,:(']/)[0], Math.round(p.seconds * 10) / 10]), [
    ["KSP", 5], ["Loading", 1], ["Instantly", 10], ["Assets", 14], ["Asset", 1], ["Other", 1], ["Waiting", 10],
    ["ModuleManager", 3], ["Part", 11], ["Other", 2], ["Planetary", 7], ["Main", 4],
  ]);
  assert.deepEqual(a.countdown.moduleManager, { startDelay: 2.5, ranIn: 33.9, waited: 10, postPatch: 3, cache: "not used" });
  const report = reportRun(a).join("\n");
  assert.match(report, /- Alongside asset loading: 23\.90 s of the patching/);
  assert.match(report, /- Main thread waited for it: 10\.00 s/);
  assert.match(report, /^> This report is from KSP.log only. The T-Minus profiler would add:$/m, "KSP.log only: says what the profiler adds");
});

test("measuring turned off in game: the log-only report says so and how to turn it on", () => {
  const off = [COUNTDOWN[0], L("10:00:00.500", "[TMinus] T-Minus 0.1.0 loaded"), L("10:00:00.600", "[TMinus] Measuring: off (turned off from the T-Minus button); no hooks, reports read KSP.log only"), ...COUNTDOWN.slice(1)];
  const a = analyzeRun(buildRun("t", off.join("\n")));
  assert.equal(a.measuringOff, true);
  assert.equal(a.input.level, "log");
  assert.match(reportRun(a).join("\n"), /^> Measuring was off in this session: .* turn it on there and restart KSP/m);
  assert.equal(analyzeRun(buildRun("t", COUNTDOWN.join("\n"))).measuringOff, undefined, "absent unless the line is there");
});

test("phases from KSP.log: a missing line joins its time to the next phase", () => {
  const a = analyzeRun(buildRun("t", COUNTDOWN.filter((l) => !l.includes("Loading Asset Bundle Definitions")).join("\n")));
  const assets = a.countdown.phases!.find((p) => p.label.startsWith("Asset bundles"))!;
  assert.equal(assets.seconds, 15);
  assert.ok(!a.countdown.phases!.some((p) => p.label.startsWith("Assets:")));
});

test("flight entry phases: scene load, setup frame, then to the overlay's end", () => {
  const log = [
    L("10:02:00.000", "[HighLogic]: =========================== Scene Change : From EDITOR to FLIGHT (Async) ====="),
    L("10:02:03.000", "------------------- initializing flight mode... ------------------"),
    L("10:02:08.000", "all systems started"),
    L("10:02:20.000", "[UIMasterController]: ShowUI"),
    L("10:03:00.000", "[HighLogic]: =========================== Scene Change : From FLIGHT to SPACECENTER (Async) ====="),
  ];
  const [e] = analyzeRun(buildRun("t", log.join("\n"))).flightEntries;
  assert.equal(e.label, "EDITOR->FLIGHT");
  assert.deepEqual(e.phases.map((p) => p.seconds), [3, 5, 12]);
  assert.match(e.phases[0].label, /buffered/);
  assert.deepEqual(analyzeRun(buildRun("t", log.filter((l) => !l.includes("all systems")).join("\n"))).flightEntries, [], "a missing line: no breakdown");
});

test("places: one under the summary's half millisecond does not make a finding session-wide", () => {
  const places = new Map<string, Place>();
  addPlace(places, { phase: "countdown" }, 0.0004);
  addPlace(places, { phase: "hold", hold: "MAINMENU->SPACECENTER" }, 2.3);
  const r = ranked(places);
  assert.deepEqual(r.where, { phase: "hold", hold: "MAINMENU->SPACECENTER" });
  assert.equal(r.places.length, 1);
  addPlace(places, { phase: "countdown" }, 0.001);
  assert.deepEqual(ranked(places).where, { phase: "session" });
});
