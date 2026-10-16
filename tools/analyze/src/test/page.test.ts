// The page's inputs block and its analyzer: filling the template, reading the
// block back, and the analyzer bundle's view of a packed log (run in a context
// with web APIs only, as check-archived runs it).
// Run with: npm --prefix tools/analyze test

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { gzipSync } from "node:zlib";
import { buildRun } from "../core/run.js";
import { analyzeRun } from "../core/model.js";
import { buildReport } from "../report/model.js";
import { buildRaw } from "../report/raw.js";
import { renderHtml } from "../report/html.js";
import { fillTemplate, INPUTS_FORMAT, INPUTS_SLOT, parseInputs, type Inputs } from "../page/inputs.js";

const pack = (text: string) => Buffer.from(gzipSync(new TextEncoder().encode(text))).toString("base64");

interface PageAnalyzer {
  gunzipBase64(b64: string): Promise<string>;
  completeLines(text: string): string;
  analyzeInputs(inputs: Inputs): Promise<{ page: string; download: string }>;
}
const web = globalThis as unknown as Record<string, unknown>;
const analyzer = runInNewContext(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "page", "analyzer.bundle.js"), "utf8"), {
  atob: web.atob,
  Blob: web.Blob,
  DecompressionStream: web.DecompressionStream,
  Response: web.Response,
  TextDecoder: web.TextDecoder,
}) as PageAnalyzer;

test("the inputs block round-trips and no text in it ends its element", () => {
  const inputs: Inputs = { format: INPUTS_FORMAT, name: "run", log: "</script><!-- x" };
  const page = fillTemplate(`<p>a</p>\n${INPUTS_SLOT}\n<p>b</p>`, inputs);
  const m = /<script type="application\/json" id="tminus-inputs">(.*)<\/script>/.exec(page);
  assert.ok(m);
  const json = m ? m[1] : "";
  assert.ok(!json.includes("<"));
  assert.deepEqual(parseInputs(json), { ...inputs, jsonl: undefined });
});

test("the template must have exactly one slot", () => {
  const inputs: Inputs = { format: INPUTS_FORMAT, name: "run", log: "" };
  assert.throws(() => fillTemplate("<p>no slot</p>", inputs));
  assert.throws(() => fillTemplate(`${INPUTS_SLOT}${INPUTS_SLOT}`, inputs));
});

test("an inputs block of another format is refused", () => {
  assert.throws(() => parseInputs(JSON.stringify({ format: INPUTS_FORMAT + 1, name: "run", log: "" })), /format/);
  assert.throws(() => parseInputs(JSON.stringify({ format: INPUTS_FORMAT, name: "run" })));
});

test("gunzip keeps a byte order mark and the analyzer drops a partial last line", async () => {
  const bom = String.fromCharCode(0xfeff);
  assert.equal(await analyzer.gunzipBase64(pack(`${bom}a\nb`)), `${bom}a\nb`);
  assert.equal(analyzer.completeLines("a\nb\npart"), "a\nb\n");
  assert.equal(analyzer.completeLines("no break"), "no break");
  const log = "[LOG 12:00:00.000] a line\n[LOG 12:00:01.000] cut mid-li";
  const r = await analyzer.analyzeInputs({ format: INPUTS_FORMAT, name: "run", log: pack(log) });
  const a = analyzeRun(buildRun("run", analyzer.completeLines(log)));
  assert.equal(r.page, renderHtml(buildReport(a), { raw: buildRaw(a) }), "the CLI's page for the complete lines");
  assert.ok(r.page.includes(`id="tab-raw"`) && !r.download.includes(`id="tab-raw"`), "Download has no Raw data tab");
});
