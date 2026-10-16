// The report model on synthetic analyses and logs: grouping by mod, points of
// attention, the headline, Hold rows, and redaction.
// Run with: npm --prefix tools/analyze test

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildRun } from "../core/run.js";
import { analyzeRun, type RunAnalysis } from "../core/model.js";
import { identifying } from "../core/identity.js";
import type { Finding } from "../core/findings/index.js";
import { buildReport, checkReport } from "../report/model.js";
import { redactor } from "../report/redact.js";

const finding = (f: Partial<Finding> & Pick<Finding, "id">): Finding => ({
  title: f.id,
  where: { phase: "countdown" },
  places: [{ where: f.where ?? { phase: "countdown" }, seconds: f.cost?.seconds ?? 1 }],
  cost: { kind: "measured", seconds: 1, method: "" },
  evidence: [],
  action: "",
  cause: f.id,
  remedy: "report",
  confidence: "measured",
  ...f,
});

const measured = (seconds: number) => ({ cost: { kind: "measured" as const, seconds, method: "" } });
const likely = (seconds: number) => ({ cost: { kind: "estimated" as const, seconds, method: "" }, confidence: "heuristic" as const });

function analysis(findings: Finding[], holds: RunAnalysis["holds"] = []): RunAnalysis {
  return {
    name: "t",
    version: "0",
    profilerOn: true,
    input: { level: "log+profiler", missing: [] },
    identifying: { roots: [], names: [] },
    countdown: { metrics: [{ label: "Main menu ready (since process start)", seconds: 100 }], loaders: [] },
    holds,
    flightEntries: [],
    aggregates: [],
    slowEvents: [],
    findings,
  };
}

test("report: one mod per group; several mods share one group, its cost counted once; no mod follows its related finding", () => {
  const a = analysis([
    finding({ id: "a", ...measured(5), mods: [{ name: "A", folder: "AFolder", role: "culprit" }] }),
    finding({ id: "b", ...measured(3), mods: [{ name: "A", role: "culprit" }] }),
    finding({ id: "c", ...likely(4), mods: [{ name: "B", role: "candidate" }, { name: "C", role: "candidate" }] }),
    finding({ id: "d", ...measured(2), mods: [{ name: "B", role: "shared" }, { name: "C", role: "shared" }] }),
    finding({ id: "e", ...measured(1), related: ["a"] }),
    finding({ id: "f", ...measured(6) }),
  ]);
  const r = buildReport(a);
  assert.deepEqual(checkReport(r, a), []);
  const g = r.countdown.groups.top.map((x) => [x.kind, x.name, x.folder, x.measured, x.likely, x.findings.length]);
  assert.deepEqual(g, [
    ["mod", "A", "AFolder", 9, 0, 3],
    ["install", "f", undefined, 6, 0, 1],
    ["mods", "B or C", undefined, 0, 4, 1],
    ["mods", "B and C", undefined, 2, 0, 1],
  ]);
  assert.equal(r.holds.groups.top.length, 0);
});

test("report: top 10 groups, then a count and totals for the rest", () => {
  const a = analysis(Array.from({ length: 12 }, (_, i) => finding({ id: `x${i}`, ...measured(12 - i), mods: [{ name: `M${i}`, role: "culprit" }] })));
  const r = buildReport(a);
  assert.equal(r.countdown.groups.top.length, 10);
  assert.deepEqual(r.countdown.groups.rest, { count: 2, measured: 2 + 1, likely: 0 });
  assert.deepEqual(checkReport(r, a), []);
});

test("report: points put actionable findings first, a measured one before a likely one twice its size, followers with their leader", () => {
  const a = analysis([
    finding({ id: "info", ...measured(50), remedy: "none" }),
    finding({ id: "guess", ...likely(20) }),
    finding({ id: "known", ...measured(10) }),
    finding({ id: "small", ...measured(9) }),
    finding({ id: "fix", ...measured(1), remedy: "fix" }),
    finding({ id: "follower", ...measured(30), remedy: "fix", related: ["fix"] }),
  ]);
  const r = buildReport(a);
  assert.deepEqual(r.countdown.points.map((i) => r.findings[i].id), ["fix", "known", "guess", "small"]);
  // The headline adds the follower: both are measured.
  const top = r.headline.top!;
  assert.equal(r.findings[top.finding].id, "fix");
  assert.equal(top.seconds, 31);
  assert.equal(top.followersAdded, true);
});

test("report: points are filled up to three with informational findings; the headline never adds a likely follower", () => {
  const a = analysis([
    finding({ id: "fix", ...measured(2), remedy: "fix" }),
    finding({ id: "follower", ...likely(8), remedy: "fix", related: ["fix"] }),
    finding({ id: "info1", ...measured(5), remedy: "none" }),
    finding({ id: "info2", ...measured(4), remedy: "none" }),
    finding({ id: "info3", ...measured(3), remedy: "none" }),
  ]);
  const r = buildReport(a);
  assert.deepEqual(r.countdown.points.map((i) => r.findings[i].id), ["fix", "info1", "info2"]);
  assert.equal(r.headline.top!.seconds, 2);
  assert.equal(r.headline.top!.followersAdded, false);
  assert.deepEqual(r.headline.countdown, { seconds: 100, source: "profiler" });
});

test("report: a Hold's unmeasured rest is the Hold less its measured costs; likely costs show inside it", () => {
  const hold = { phase: "hold" as const, hold: "EDITOR->FLIGHT" };
  const a = analysis(
    [
      finding({ id: "m", ...measured(3), where: hold, places: [{ where: hold, seconds: 3 }] }),
      finding({ id: "l", ...likely(4), where: hold, places: [{ where: hold, seconds: 4 }] }),
      finding({ id: "both", ...measured(3), where: { phase: "session" }, places: [{ where: { phase: "countdown" }, seconds: 2 }, { where: hold, seconds: 1 }] }),
    ],
    [{ label: "EDITOR->FLIGHT", seconds: 10, source: "profiler" }],
  );
  const r = buildReport(a);
  const row = r.holds.rows[0];
  assert.equal(row.name, "Editor → Flight");
  assert.equal(row.unmeasured, 6);
  assert.equal(row.likely, 4);
  assert.deepEqual(row.costs.top.map((c) => [r.findings[c.finding].id, c.seconds, c.certainty]), [["l", 4, "likely"], ["m", 3, "measured"], ["both", 1, "measured"]]);
  // A finding split across parts counts in each part by its places there.
  assert.equal(r.countdown.groups.top.find((g) => g.name === "both")!.measured, 2);
  assert.equal(r.holds.groups.top.find((g) => g.name === "both")!.measured, 1);
  assert.deepEqual(checkReport(r, a), []);
});

const LOG = [
  "[LOG 10:00:00.000] ******* Log Initiated for Kerbal Space Program - 1.12.5.3190 (WindowsPlayer x64) en-us *******",
  "Kerbal Space Program - 1.12.5.3190 (WindowsPlayer x64) en-us",
  "OS: Windows 10  (10.0.0) 64bit",
  "CPU: Some CPU (8)",
  "RAM: 16384",
  "GPU: Some GPU (8192MB)",
  "[LOG 10:00:01.000] AssemblyLoader: Loading assembly at C:\\Users\\jdoe\\Games\\Kerbal Space Program\\GameData\\SomeMod\\Plugins\\SomeMod.dll",
  "[LOG 10:00:02.000] Game State Saved to saves/My Career/persistent",
  "[LOG 10:00:03.000] Loading ship from file: C:\\Users\\jdoe\\Games\\Kerbal Space Program\\saves\\My Career\\Ships\\VAB\\Big Rocket.craft",
  "[LOG 10:00:04.000] [FLIGHT GLOBALS]: Switching To Vessel Big Rocket ---------------------- ",
  "[LOG 10:00:05.000] Crewmember Valentina Kerman assigned to Mk1 Command Pod, seat # 0",
  "[LOG 10:00:06.000] Crewmember Zed is available again",
  "[LOG 10:00:07.000] Steam user 76561198000000001 logged in, cache at D:\\Temp\\other\\file.txt",
];

test("redaction: paths keep their part from GameData; users, other paths, saves, vessels, Kerbals and Steam ids go; hardware stays", () => {
  const run = buildRun("t", LOG.join("\n"));
  const id = identifying(run);
  const redact = redactor(id);
  const text = (n: number) => redact(run.log.find((l) => l.n === n)!.text);
  assert.equal(text(7), "AssemblyLoader: Loading assembly at GameData\\SomeMod\\Plugins\\SomeMod.dll");
  assert.equal(text(8), "Game State Saved to saves/<save>/persistent");
  assert.equal(text(9), "Loading ship from file: <KSP>\\saves\\<save>\\Ships\\VAB\\<vessel>.craft");
  assert.equal(text(10), "[FLIGHT GLOBALS]: Switching To Vessel <vessel> ---------------------- ");
  assert.equal(text(11), "Crewmember <Kerbal> assigned to Mk1 Command Pod, seat # 0");
  assert.equal(text(12), "Crewmember <Kerbal> is available again");
  assert.equal(text(13), "Steam <user> <id> logged in, cache at <path>".replace("<user>", "user"));
  assert.ok(!redact("C:\\Users\\jdoe\\x").includes("jdoe"));
  const a = analyzeRun(run);
  assert.deepEqual(a.system, { ksp: "1.12.5.3190 (WindowsPlayer x64)", os: "Windows 10  (10.0.0) 64bit", cpu: "Some CPU (8)", ramMb: 16384, gpu: "Some GPU (8192MB)" });
  const r = buildReport(a);
  assert.deepEqual(r.run.system, a.system);
  assert.deepEqual(checkReport(r, a), []);
});
