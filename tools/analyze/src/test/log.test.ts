// KSP.log parsing: the timeline, and ModuleManager's log dump kept apart from it
// (docs/mechanisms.md, 1.6). Run with: npm --prefix tools/analyze test

import { test } from "node:test";
import assert from "node:assert/strict";
import { parseLog } from "../core/log.js";
import { buildRun } from "../core/run.js";
import { analyzeRun } from "../core/model.js";
import { gaps } from "../core/timeline.js";

const L = (time: string, text: string, level = "LOG") => `[${level} ${time}] ${text}`;
const hms = (h: number, m: number, s: number) => h * 3600 + m * 60 + s;

// A cold startup: MM's lines inside the dump are stamped while it patched, up to minutes before the dump.
const COLD = [
  L("04:31:28.906", "[ModuleManager] Patching started on a new thread, all output will be directed to x"),
  L("04:33:20.917", "[ModuleManager] Waited 65.452s for patching to finish"),
  L("04:33:20.923", "[ModuleManager] "),
  "#### BEGIN MODULEMANAGER LOG ####",
  "",
  L("04:31:52.243", "Checking Cache"),
  L("04:33:19.644", "Errors in patch prevents the creation of the cache", "WRN"),
  L("04:33:20.905", "ModuleManager: 3 patches applied, found <color=orange>1 error</color>"),
  "1 error related to GameData/SomeMod/a.cfg",
  "",
  "#### END MODULEMANAGER LOG ####",
  L("04:33:21.235", "[ModuleManager] Reloading resources definitions"),
];

test("log: MM's dump is kept out of the timeline, with its own clock", () => {
  const { lines, mmDumps } = parseLog(COLD.join("\n"));
  assert.deepEqual(lines.map((l) => l.n), [1, 2, 3, 12]);
  assert.equal(mmDumps.length, 1);
  const [dump] = mmDumps;
  assert.equal(dump.complete, true);
  assert.equal(dump.entry.n, 3);
  assert.deepEqual(dump.lines.map((l) => [l.n, l.text.slice(0, 14)]), [[6, "Checking Cache"], [7, "Errors in patc"], [8, "ModuleManager:"]]);
  assert.equal(dump.lines[0].t, hms(4, 31, 52.243), "this session's clock, before the entry");
  assert.deepEqual(dump.lines[2].more?.map((m) => m.text), ["1 error related to GameData/SomeMod/a.cfg"]);
  assert.equal(dump.patchLog, undefined);
});

test("log: a gap across the dump is measured on the timeline only", () => {
  const run = buildRun("t", COLD.join("\n"));
  // On the timeline, the dump's entry and the next line are 0.3 s apart; MM's own lines would add a 1.3 s gap.
  assert.deepEqual(gaps(run, hms(4, 33, 0), hms(4, 34, 0), 0.5), []);
});

// A startup that used the cache: the nested patch log is from an earlier session, stamped later in the day.
const CACHED = [
  L("04:31:00.000", "[ModuleManager] "),
  "#### BEGIN MODULEMANAGER LOG ####",
  L("04:30:55.000", "Loading from Cache"),
  L("04:30:58.000", "Dumping patch log"),
  L("04:30:58.001", ""),
  "#### BEGIN PATCH LOG ####",
  L("23:10:00.000", "Log started at 2026-10-14 23:10:00.000"),
  L("23:10:30.000", "Applying update SomeMod/x/@KSP_COMMUNITY_FIXES to KSPCommunityFixes/Settings.cfg/KSP_COMMUNITY_FIXES"),
  L("23:11:00.000", "Errors in patch prevents the creation of the cache", "WRN"),
  "#### END PATCH LOG ####",
  L("04:30:59.000", "ModuleManager: 3 patches loaded from cache"),
  "#### END MODULEMANAGER LOG ####",
  L("04:31:05.000", "[ModuleManager] Post patch ran in 5.000s"),
];

test("log: a nested patch log from another session does not move the timeline to the next day", () => {
  const { lines, mmDumps } = parseLog(CACHED.join("\n"));
  assert.deepEqual(lines.map((l) => l.t), [hms(4, 31, 0), hms(4, 31, 5)]);
  const [dump] = mmDumps;
  assert.deepEqual(dump.lines.map((l) => l.text), ["Loading from Cache", "Dumping patch log", "", "ModuleManager: 3 patches loaded from cache"]);
  assert.equal(dump.patchLog?.length, 3);
  assert.equal(dump.patchLog![0].t, hms(23, 10, 0), "its own clock");
});

test("log: MM rules read only this startup's part of the dump", () => {
  const ids = analyzeRun(buildRun("t", CACHED.join("\n"))).findings.map((f) => f.id);
  assert.ok(!ids.includes("mm-cache-not-saved"), "the line in the nested patch log is from another startup");
});

test("log: a dump without its closing marker is incomplete, and MM rules report nothing", () => {
  const run = buildRun("t", COLD.slice(0, 9).join("\n"));
  assert.equal(run.mmDumps[0].complete, false);
  assert.deepEqual(analyzeRun(run).findings, []);
});

test("log: without MM's dump, MM's lines are not looked for elsewhere", () => {
  const log = [L("10:00:00.000", "Errors in patch prevents the creation of the cache", "WRN"), L("10:00:01.000", "[ModuleManager] Waited 9.000s for patching to finish")];
  assert.deepEqual(analyzeRun(buildRun("t", log.join("\n"))).findings, []);
});

test("log: a timeline crossing midnight keeps counting, also with a dump", () => {
  const log = [L("23:59:59.000", "[ModuleManager] "), "#### BEGIN MODULEMANAGER LOG ####", L("23:59:58.000", "Checking Cache"), "#### END MODULEMANAGER LOG ####", L("00:00:01.000", "next")];
  const { lines, mmDumps } = parseLog(log.join("\n"));
  assert.deepEqual(lines.map((l) => l.t), [hms(23, 59, 59), 86400 + 1]);
  assert.equal(mmDumps[0].lines[0].t, hms(23, 59, 58));
});
