// The expectations format of check-archived, on test-fixtures/expectations.example.json:
// the example must stay valid, every kind of check must pass and fail when it
// should, and anything the format does not know is an error.
// Run with: npm --prefix tools/analyze test

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildRun } from "../core/run.js";
import { analyzeRun } from "../core/model.js";
import { installedMods } from "../core/mods.js";
import type { Finding } from "../core/findings/index.js";
import { failures, parseExpectations, type RunFacts } from "../cli/expectations.js";

// This file runs from dist/test.
const EXAMPLE = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../test-fixtures/expectations.example.json"), "utf8");
const [example, stock] = parseExpectations(EXAMPLE).suites;

const L = (time: string, text: string, level = "LOG") => `[${level} ${time}] ${text}`;

// ModuleManager patching with an error in SomeMod, then a Hold into flight with a 3 s silence after SlowMod's line.
const LOG = [
  L("09:58:00.000", "Load(Assembly): SlowMod/Plugins/SlowMod"),
  L("10:00:01.000", "[ModuleManager] Waited 60.500s for patching to finish"),
  L("10:00:01.100", "[ModuleManager] Dumping ModuleManager log to main log"),
  L("10:00:01.200", "[ModuleManager] "),
  "#### BEGIN MODULEMANAGER LOG ####",
  L("09:59:00.002", "Error - Cannot parse variable search when replacing (%) key bar = #$foo$", "ERR"),
  L("09:59:59.000", "Errors in patch prevents the creation of the cache", "WRN"),
  L("09:59:59.100", "ModuleManager: 100 patches applied, found 1 error"),
  "1 error related to GameData/SomeMod/Patches/compat.cfg",
  "",
  "#### END MODULEMANAGER LOG ####",
  L("10:05:00.000", "[HighLogic]: =========================== Scene Change : From EDITOR to FLIGHT (Async) ====================="),
  L("10:05:01.000", "[SlowMod] building things"),
  L("10:05:04.000", "[UIMasterController]: HideUI"),
  L("10:05:07.500", "[UIMasterController]: ShowUI"),
];

function facts(log: string[]): RunFacts {
  const run = buildRun("t", log.join("\n"));
  const a = analyzeRun(run);
  const modFolders = [...new Set(installedMods(run).map((m) => m.folder))];
  return { level: a.input.level, diagnostic: false, holds: a.holds.map((h) => h.label), partDatabase: a.partDatabase, modFolders, findings: a.findings };
}

const finding = (f: Partial<Finding> & Pick<Finding, "id">): Finding => ({
  title: "",
  where: { phase: "countdown" },
  cost: { kind: "measured", seconds: 2, method: "" },
  evidence: [],
  action: "",
  confidence: "measured",
  ...f,
});

test("expectations: the example passes on a run that shows what it describes", () => {
  const run = facts(LOG);
  assert.deepEqual(run.holds, ["EDITOR->FLIGHT"]);
  assert.deepEqual(failures(example, run), []);
});

test("expectations: a finding check fails when no finding matches; when skips the rest", () => {
  // No MM errors, and no Hold into flight: the flight check does not apply.
  const run = facts(LOG.slice(0, 1));
  assert.deepEqual(failures(example, run), ["MM cache not saved: errors in SomeMod"]);
});

test("expectations: absent, level, diagnostic and informational", () => {
  const addon = finding({ id: "expensive-addon", title: "Expensive addon Start: X.Y (X)" });
  const parts = finding({ id: "part-parsing-by-mod", informational: true });
  const base: RunFacts = { level: "log", diagnostic: false, holds: [], modFolders: [], findings: [finding({ id: "mm-cache-not-saved", subject: "SomeMod", cost: { kind: "measured", seconds: 61, method: "" }, evidence: [{ source: "log", text: "1 error related to GameData/SomeMod/a.cfg" }] })] };

  assert.deepEqual(failures(example, { ...base, findings: [...base.findings, addon] }), ["no profiler findings from KSP.log alone"]);
  assert.deepEqual(failures(example, { ...base, level: "log+summary", diagnostic: true }), ["addon Start timed in diagnostic mode"]);
  assert.deepEqual(failures(example, { ...base, level: "log+summary", diagnostic: true, findings: [...base.findings, addon] }), []);
  assert.deepEqual(failures(example, { ...base, level: "log+profiler", findings: [...base.findings, { ...parts, informational: false }] }), ["part compilation is informational"]);
  assert.deepEqual(failures(example, { ...base, level: "log+profiler", findings: [...base.findings, parts] }), []);
});

test("expectations: minSeconds, and place falls back to where without places", () => {
  const run = facts(LOG);
  const mm = run.findings.find((f) => f.id === "mm-cache-not-saved")!;
  assert.deepEqual(failures(example, { ...run, findings: run.findings.map((f) => (f === mm ? { ...mm, cost: { ...mm.cost, seconds: 59 } } : f)) }), ["MM cache not saved: errors in SomeMod"]);
  const stall = finding({ id: "long-stall-by-mod", subject: "SlowMod", title: "Long stall attributed to SlowMod", where: { phase: "hold", hold: "EDITOR->FLIGHT" } });
  assert.deepEqual(failures(example, { ...run, findings: [mm, stall] }), []);
  assert.deepEqual(failures(example, { ...run, findings: [mm, { ...stall, places: [{ where: { phase: "countdown" }, seconds: 2 }] }] }), ["SlowMod stalls flight entry"]);
});

test("expectations: partDatabase, read from PartLoader's log line", () => {
  const db = (text: string) => facts([...LOG, L("10:06:00.000", text)]);
  assert.equal(facts(LOG).partDatabase, undefined);
  assert.equal(db("PartLoader: Loading part database").partDatabase, "loaded");
  assert.equal(db("PartLoader: Creating part database").partDatabase, "created");
  assert.equal(db("PartLoader: Version strings do not match. Creating part database.").partDatabase, "version-changed");
  // Unknown or loaded: the check does not apply; created without a drag cube finding: it fails.
  assert.deepEqual(failures(example, facts(LOG)), []);
  assert.deepEqual(failures(example, db("PartLoader: Loading part database")), []);
  assert.deepEqual(failures(example, db("PartLoader: Creating part database")), ["drag cubes rendered when PartLoader starts a new database"]);
});

test("expectations: mod, from the run's Load(Assembly) lines", () => {
  const suite = parseExpectations(JSON.stringify({ format: 1, suites: [{ name: "s", runs: "r", expect: [
    { name: "with SomeMod", when: { mod: ["SomeMod"] }, count: 1 },
    { name: "without SomeMod", when: { mod: ["!SomeMod"] }, count: 0 },
  ] }] })).suites[0];
  const withMod = facts([L("10:00:00.000", "Load(Assembly): SomeMod/Plugins/SomeMod"), L("10:00:00.100", "Load(Assembly): Squad/Plugins/KSPSteamCtrlr")]);
  assert.deepEqual(withMod.modFolders, ["SomeMod"]);
  assert.deepEqual(failures(suite, withMod), ["with SomeMod"]);
  assert.deepEqual(failures(suite, { ...withMod, modFolders: [] }), []);
});

test("expectations: count", () => {
  assert.deepEqual(failures(stock, { level: "log", diagnostic: false, holds: [], modFolders: [], findings: [] }), []);
  assert.deepEqual(failures(stock, { level: "log", diagnostic: false, holds: [], modFolders: [], findings: [finding({ id: "x" })] }), ["no findings"]);
});

test("expectations: anything the format does not know is an error", () => {
  const withCheck = (check: object, extra: object = {}) => JSON.stringify({ format: 1, suites: [{ name: "s", runs: "r", expect: [{ name: "c", ...check }] }], ...extra });
  const invalid: [string, RegExp][] = [
    ["not json", /not valid JSON/],
    [withCheck({ count: 0 }, { format: 2 }), /format: expected 1/],
    [withCheck({ count: 0 }, { notes: "" }), /unknown key notes/],
    [JSON.stringify({ format: 1, suites: [{ name: "s", runs: "r", expect: [] }] }), /expect: expected a non-empty list/],
    [withCheck({}), /exactly one of finding, absent, count/],
    [withCheck({ count: 0, absent: { id: "x" } }), /exactly one of finding, absent, count/],
    [withCheck({ count: 1.5 }), /count: expected a whole number/],
    [withCheck({ finding: { id: "x", minSecs: 1 } }), /finding: unknown key minSecs/],
    [withCheck({ finding: { id: "x", title: "a(" } }), /finding\.title: invalid regex/],
    [withCheck({ finding: { id: [] } }), /finding\.id: expected a string or a non-empty list/],
    [withCheck({ finding: { id: "x", phase: "flight" } }), /finding\.phase: expected one of/],
    [withCheck({ when: { level: "jsonl" }, count: 0 }), /when\.level\[0\]: expected one of/],
    [withCheck({ when: { partDatabase: "rebuilt" }, count: 0 }), /when\.partDatabase\[0\]: expected one of/],
    [withCheck({ finding: { id: "x", place: { hold: "" } } }), /place\.hold: expected a non-empty string/],
  ];
  for (const [text, error] of invalid) {
    let message = "";
    try {
      parseExpectations(text);
    } catch (e) {
      message = (e as Error).message;
    }
    assert.match(message, error, `${text} → ${message || "no error"}`);
  }
});
