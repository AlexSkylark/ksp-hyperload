// The profiler's KSP.log summary, format 2 (src/TMinus/Profiler/LogSummary.cs).

import { test } from "node:test";
import assert from "node:assert/strict";
import { parseLog } from "../core/log.js";
import { parseSummary } from "../core/summary.js";

const L = (time: string, text: string) => `[LOG ${time}] ${text}`;
const MB = 1024 * 1024;

const log = [
  L("10:04:22.000", "[TMinus] Summary (format 2): Countdown ready at 261.930 s (main menu scene 57.28 s), this line at 262.000 s after process start"),
  L("10:04:22.000", "[TMinus] Summary: GC incremental yes, mode Enabled"),
  L("10:04:22.000", "[TMinus] Summary: KSPCF setting ForceSyncSceneSwitch: true -> false"),
  L("10:04:22.000", "[TMinus] Summary: KSPCF setting +Extra = 1"),
  L("10:04:22.000", "[TMinus] Summary: long frame LOADING at 11.143 s, 22.600 s, 7 GC"),
  L("10:04:22.000", "[TMinus] Summary: scenario ResearchAndDevelopment 120 ms, 1 module"),
  L("10:04:22.000", "[TMinus] Summary: addon memory SomeMod/SomeMod.Loader +40 MB"),
  L("10:04:22.000", "[TMinus] Summary: memory managed 1792 MB, heap 1971 MB, unity 8904 MB, 704 GC"),
  L("10:04:22.000", "[TMinus] Summary: end | 1 long frame 22.6 s, scenario 0.1 s"),
  L("10:06:00.000", "[TMinus] Summary (format 2): Hold MAINMENU->SPACECENTER 16.42 s, ready at 360.000 s, this line at 360.000 s after process start"),
  L("10:06:00.000", "[TMinus] Summary: switch buffered steps 0.384 s in 2, overlay after GUI ready 3.533 s"),
  L("10:06:00.000", "[TMinus] Summary: terrain Kerbin 850 ms, 1 start"),
  L("10:06:00.000", "[TMinus] Summary: memory managed 1882 MB, heap 2164 MB, unity 9379 MB, 7 GC"),
  L("10:06:00.000", "[TMinus] Summary: end | terrain 0.9 s"),
].join("\n");

const records = parseSummary(parseLog(log).lines)!.records;
const one = (pred: (r: any) => boolean) => {
  const found = records.filter(pred);
  assert.equal(found.length, 1, JSON.stringify(found));
  return found[0];
};

test("summary format 2: facts from the Countdown block become one facts record", () => {
  const facts = one((r) => r.kind === "facts");
  assert.equal(facts.gcIncremental, true);
  assert.equal(facts.gcMode, "Enabled");
  assert.deepEqual(facts.kspcfSettingsChanged, ["ForceSyncSceneSwitch: true -> false", "+Extra = 1"]);
  assert.equal(facts.kspcfSettingsNodes, undefined);
  assert.equal(records.filter((r) => r.kind === "run" || r.kind === "conditions").length, 0);
});

test("summary format 2: long frames carry their collections", () => {
  const frame = one((r) => r.name === "frame.long");
  assert.equal(frame.gcCount, 7);
  assert.equal(frame.dur, 22600);
});

test("summary format 2: new families, switch steps, overlay wait", () => {
  assert.equal(one((r) => r.name === "scenario.load").detail, "ResearchAndDevelopment");
  assert.equal(one((r) => r.name === "pqs.forceStart").total, 850);
  const step = one((r) => r.name === "scene.bufferedLoad.step");
  assert.equal(step.dur, 384);
  assert.equal(step.steps, 2);
  const overlay = one((r) => r.name === "scene.overlayAfterGuiReady");
  assert.equal(overlay.detail, "MAINMENU->SPACECENTER");
  assert.equal(overlay.value, 3533);
});

test("summary format 2: memory per block with running collections, addon growth", () => {
  const memory = records.filter((r) => r.kind === "memory");
  assert.deepEqual(memory.map((r) => [r.detail, r.gcCount, r.monoUsed / MB]), [
    ["LOADING->MAINMENU", 704, 1792],
    ["MAINMENU->SPACECENTER", 711, 1882],
  ]);
  assert.equal(one((r) => r.name === "addon.awake.monoGrowth").value, 40 * MB);
});

test("summary format 1 still parses, without the format 2 records", () => {
  const v1 = parseSummary(parseLog([
    L("10:04:22.000", "[TMinus] Summary (format 1): Countdown ready at 261.930 s (main menu scene 57.28 s), this line at 262.000 s after process start"),
    L("10:04:22.000", "[TMinus] Summary: long frame MAINMENU at 204.644 s, 48.000 s"),
    L("10:04:22.000", "[TMinus] Summary: end | 1 long frame 48.0 s"),
  ].join("\n")).lines)!.records;
  const frame = v1.find((r) => r.name === "frame.long")!;
  assert.equal(frame.gcCount, undefined);
  assert.equal(v1.filter((r) => r.kind === "facts" || r.kind === "memory").length, 0);
});
