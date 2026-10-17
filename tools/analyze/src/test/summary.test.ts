// The profiler's KSP.log summary, formats 1 to 5 (src/TMinus/Profiler/LogSummary.cs).

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

test("summary format 4: covered runs per long frame", () => {
  const v4 = parseSummary(parseLog([
    L("10:04:22.000", "[TMinus] Summary (format 4): Countdown ready at 261.930 s (main menu scene 57.28 s), this line at 262.000 s after process start"),
    L("10:04:22.000", "[TMinus] Summary: long frame MAINMENU at 204.644 s, 48.000 s, 3 GC, covered 1.250 s, runs 210.100+0.900:0.880 230.000+0.300:0.300"),
    L("10:04:22.000", "[TMinus] Summary: end | 1 long frame 48.0 s"),
  ].join("\n")).lines)!;
  assert.equal(v4.format, 4);
  assert.equal(v4.records.find((r) => r.name === "frame.long")!.covered, 1250);
  assert.deepEqual(v4.records.filter((r) => r.name === "frame.covered").map((r) => [r.t, r.dur, r.covered, r.detail]), [
    [210100, 900, 880, "MAINMENU"],
    [230000, 300, 300, "MAINMENU"],
  ]);
});

test("summary format 5: coroutine steps per type and per assembly", () => {
  const v5 = parseSummary(parseLog([
    L("10:04:22.000", "[TMinus] Summary (format 5): Countdown ready at 261.930 s (main menu scene 57.28 s), this line at 262.000 s after process start"),
    L("10:04:22.000", "[TMinus] Summary: coroutine Scatterer/Scatterer.Core+<Init>d__4 900 ms, 120 steps"),
    L("10:04:22.000", "[TMinus] Summary: coroutine (other 3) 12 ms, 1 step"),
    L("10:04:22.000", "[TMinus] Summary: coroutines Scatterer 1300 ms, 410 steps"),
    L("10:04:22.000", "[TMinus] Summary: end | coroutine 0.9 s"),
  ].join("\n")).lines)!;
  assert.equal(v5.format, 5);
  const get = (name: string) => v5.records.filter((r) => r.name === name).map((r) => [r.detail, r.total, r.count]);
  assert.deepEqual(get("coroutine.step"), [["Scatterer/Scatterer.Core+<Init>d__4", 900, 120], ["(other 3)", 12, 1]]);
  assert.deepEqual(get("coroutine.byAssembly"), [["Scatterer", 1300, 410]]);
});

test("summary format 6: Unity messages per method and per assembly", () => {
  const v6 = parseSummary(parseLog([
    L("10:04:22.000", "[TMinus] Summary (format 6): Countdown ready at 261.930 s (main menu scene 57.28 s), this line at 262.000 s after process start"),
    L("10:04:22.000", "[TMinus] Summary: message Kopernicus/Kopernicus.RuntimeUtility.RuntimeUtility.LateUpdate 420 ms, 900 calls"),
    L("10:04:22.000", "[TMinus] Summary: messages Kopernicus 610 ms, 2400 calls"),
    L("10:04:22.000", "[TMinus] Summary: end | message 0.4 s"),
  ].join("\n")).lines)!;
  assert.equal(v6.format, 6);
  const get = (name: string) => v6.records.filter((r) => r.name === name).map((r) => [r.detail, r.total, r.count]);
  assert.deepEqual(get("unity.message"), [["Kopernicus/Kopernicus.RuntimeUtility.RuntimeUtility.LateUpdate", 420, 900]]);
  assert.deepEqual(get("unity.message.byAssembly"), [["Kopernicus", 610, 2400]]);
});

test("summary format 3: covered time, modules, Harmony patching, per-call overhead", () => {
  const v3 = parseSummary(parseLog([
    L("10:04:22.000", "[TMinus] Summary (format 3): Countdown ready at 261.930 s (main menu scene 57.28 s), this line at 262.000 s after process start"),
    L("10:04:22.000", "[TMinus] Summary: long frame MAINMENU at 204.644 s, 48.000 s, 3 GC, covered 1.250 s"),
    L("10:04:22.000", "[TMinus] Summary: scenario Assembly-CSharp/ResearchAndDevelopment 120 ms, 1 module"),
    L("10:04:22.000", "[TMinus] Summary: module RSE/RocketSoundEnhancement.RSE_Engines 310 ms, 714 calls"),
    L("10:04:22.000", "[TMinus] Summary: modules RSE 480 ms, 2210 calls"),
    L("10:04:22.000", "[TMinus] Summary: harmony patch KSPCommunityFixes/KSPCommunityFixes 1520 ms, 610 patches"),
    L("10:04:22.000", "[TMinus] Summary: harmony unpatch KSPCommunityFixes/KSPCommunityFixes 12 ms, 1 unpatch"),
    L("10:04:22.000", "[TMinus] Summary: patch call calibration 50.0 ns, body 24.0 ns per call"),
    L("10:04:22.000", "[TMinus] Summary: patch calls bracketed 199, skipped 181 (own=11,transpiler-only=170)"),
    L("10:04:22.000", "[TMinus] Summary: patch call Assembly-CSharp/PQS.BuildTangents 28 ms, 1875 calls, body 310 ms, by KSPCommunityFixes/KSPCommunityFixes,RSE/RSE"),
    L("10:04:22.000", "[TMinus] Summary: patch call (other 25) 12 ms, 5000 calls, body 30 ms"),
    L("10:04:22.000", "[TMinus] Summary: end | 1 long frame 48.0 s"),
  ].join("\n")).lines)!.records;
  const get = (name: string) => v3.filter((r) => r.name === name);
  assert.equal(get("frame.long")[0].covered, 1250);
  assert.equal(get("scenario.load")[0].detail, "Assembly-CSharp/ResearchAndDevelopment");
  assert.deepEqual(get("module.byType").map((r) => [r.detail, r.total, r.count]), [["RSE/RocketSoundEnhancement.RSE_Engines", 310, 714]]);
  assert.deepEqual(get("module.byAssembly").map((r) => [r.detail, r.count]), [["RSE", 2210]]);
  assert.equal(get("harmony.patch")[0].count, 610);
  assert.equal(get("harmony.unpatch")[0].total, 12);
  assert.deepEqual(get("harmony.call.calibration.patches").map((r) => r.value), [50]);
  assert.deepEqual(get("harmony.call.skipped").map((r) => [r.value, r.detail]), [[181, "own=11,transpiler-only=170"]]);
  assert.deepEqual(get("harmony.call.patches").map((r) => [r.detail, r.total, r.count]), [
    ["Assembly-CSharp/PQS.BuildTangents", 28, 1875],
    ["(other 25)", 12, 5000],
  ]);
  assert.equal(get("harmony.call.body")[0].total, 310);
  assert.deepEqual(get("harmony.call.bracket").map((r) => r.detail), ["Assembly-CSharp/PQS.BuildTangents: KSPCommunityFixes/KSPCommunityFixes,RSE/RSE"]);
});
