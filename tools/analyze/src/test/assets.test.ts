// Per-file asset loads from KSP.log's "Load" lines (core/assets.ts), stock
// and FastLoader forms. Run with: npm --prefix tools/analyze test

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildRun } from "../core/run.js";
import { assetLoads } from "../core/assets.js";

const L = (time: string, text: string, level = "LOG") => `[${level} ${time}] ${text}`;
const loads = (log: string[]) => assetLoads(buildRun("t", log.join("\n")));
const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-6, `${a} != ${b}`);

const STOCK = [
  L("10:00:00.000", "Load(Assembly): ModA/Plugins/ModA"),
  L("10:00:01.000", "Load(Audio): Squad/Sounds/a"),
  L("10:00:01.100", "Load(Texture): Squad/Parts/x_NRM"),
  L("10:00:01.200", "Texture resolution is not valid for compression: 'x_NRM'", "WRN"),
  L("10:00:02.100", "Load(Texture): ModA/Parts/y OUT OF DATE"),
  L("10:00:02.400", "Load(Model): ModA/Parts/model"),
  L("10:00:02.900", "Loading Asset Bundle Definitions"),
  L("10:00:30.000", "[HighLogic]: =========================== Scene Change : From LOADING to MAINMENU (Async) ====================="),
  L("10:01:00.000", "Load(Texture): ModA/Parts/reloaded"),
  L("10:01:09.000", "Reload done"),
];

test("assets: stock lines, each file to the next asset line or the phase's end", () => {
  const a = loads(STOCK)!;
  assert.equal(a.loader, "stock");
  assert.equal(a.concurrentAudio, undefined);
  assert.deepEqual(a.files.map((f) => [f.url, f.folder, f.kind, f.format]), [
    ["Squad/Sounds/a", "Squad", "audio", "Audio"],
    ["Squad/Parts/x_NRM", "Squad", "texture", "Texture"],
    ["ModA/Parts/y", "ModA", "texture", "Texture"],
    ["ModA/Parts/model", "ModA", "model", "Model"],
  ]);
  // The warning is about x_NRM and does not end its time; the Countdown ends before the reload.
  a.files.forEach((f, i) => near(f.seconds, [0.1, 1.0, 0.3, 0.5][i]));
  near(a.seconds, 1.9);
  assert.deepEqual(a.byFolder.map((g) => [g.key, g.files]), [["Squad", 2], ["ModA", 2]]);
  assert.deepEqual(a.byFormat.map((g) => g.key), ["Texture", "Model", "Audio"]);
});

const FAST = [
  L("10:00:00.000", "[KSPCF] Injecting FastLoader..."),
  L("10:00:01.000", "Load Audio: ModS/Sounds/boom"),
  L("10:00:01.020", "Load Audio: ModS/Sounds/hum"),
  L("10:00:01.500", "Load DDS texture: Squad/Parts/a"),
  L("10:00:01.600", "Load Cached PNG Texture: ModA/Parts/b"),
  L("10:00:01.650", "Load Texture: ModA/Parts/c"),
  L("10:00:01.700", "Load MU model: ModA/Parts/m"),
  L("10:00:01.800", "Loading Asset Bundle Definitions"),
  L("10:00:20.000", "[KSPCF:FastLoader] some CPU | 16384 MB | some GPU"),
  "Total loading time to main menu : 20,000s",
  "- 6 assets loaded in 0,850s :",
];

test("assets: FastLoader lines, concurrent audio left out, its report read", () => {
  const a = loads(FAST)!;
  assert.equal(a.loader, "FastLoader");
  assert.deepEqual(a.files.map((f) => [f.kind, f.format]), [
    ["audio", "Audio"], ["audio", "Audio"], ["texture", "DDS texture"], ["texture", "Cached PNG Texture"], ["texture", "Texture"], ["model", "MU model"],
  ]);
  assert.equal(a.concurrentAudio?.files, 2);
  near(a.concurrentAudio!.seconds, 0.5);
  near(a.seconds, 0.3);
  assert.deepEqual(a.byFolder.map((g) => g.key), ["ModA", "Squad"]);
  assert.equal(a.byFormat.some((g) => g.key === "Audio"), false);
  assert.equal(a.reported?.files, 6);
  near(a.reported!.seconds, 0.85);
});

test("assets: no per-file line, no result; similar lines are not assets", () => {
  assert.equal(loads([L("10:00:00.000", "Load(Assembly): ModA/Plugins/ModA"), L("10:00:01.000", "Loading Asset Bundle Definitions"), L("10:00:02.000", "Load Systems: done")]), undefined);
});

test("assets: a log cut inside the asset phase gives the last file no time", () => {
  const a = loads([L("10:00:01.000", "Load(Texture): ModA/a"), L("10:00:01.500", "Load(Texture): ModA/b")])!;
  assert.deepEqual(a.files.map((f) => f.seconds), [0.5, 0]);
});
