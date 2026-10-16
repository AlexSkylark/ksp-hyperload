// The page's analysis: the inputs the mod embeds in the template, through the
// same core and report code as the CLI, to the two pages (the local one with
// its Raw data tab, and the one Download saves). Web APIs only, no DOM:
// check-archived runs this module's bundle in Node to compare it with the CLI.

import { analyzeRun } from "../core/model.js";
import { buildRun } from "../core/run.js";
import { renderHtml } from "../report/html.js";
import { buildReport, type Report } from "../report/model.js";
import { buildRaw } from "../report/raw.js";
import { renderSummary } from "../report/text.js";
import type { Inputs } from "./inputs.js";

export { parseInputs } from "./inputs.js";

/** Text from gzip in base64. A byte order mark stays, as Node's readFileSync keeps it. */
export async function gunzipBase64(b64: string): Promise<string> {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new TextDecoder("utf-8", { ignoreBOM: true }).decode(await new Response(stream).arrayBuffer());
}

/**
 * Text up to its last line break. KSP flushes KSP.log every ~21 messages and
 * the profiler writes while the game runs, so a file read mid-session can end
 * in a partial line.
 */
export function completeLines(text: string): string {
  const end = text.lastIndexOf("\n");
  return end < 0 ? text : text.slice(0, end + 1);
}

/** What the page build puts around the report: the fonts' CSS and the behavior script. */
export interface Look {
  fonts?: string;
  script?: string;
}

export interface Rendered {
  report: Report;
  /** The local page, with the Raw data tab. */
  page: string;
  /** The page Download saves: no Raw data tab. */
  download: string;
  summary: string;
}

export async function analyzeInputs(inputs: Inputs, look: Look = {}): Promise<Rendered> {
  const log = completeLines(await gunzipBase64(inputs.log));
  const jsonl = inputs.jsonl === undefined ? undefined : completeLines(await gunzipBase64(inputs.jsonl));
  const a = analyzeRun(buildRun(inputs.name, log, jsonl));
  const report = buildReport(a);
  return {
    report,
    page: renderHtml(report, { ...look, raw: buildRaw(a) }),
    download: renderHtml(report, look),
    summary: renderSummary(report),
  };
}
