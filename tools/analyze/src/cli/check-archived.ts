// Checks the findings on archived runs against an expectations file.
//
// Usage: node tools/analyze/dist/cli/check-archived.js <expectations.json>
//
// The expectations describe the installs the runs come from, so the file
// lives outside the repo, next to the run archive (format: expectations.ts,
// example: test-fixtures/expectations.example.json). Each suite's folder holds
// one folder per run (KSP.log, and the .jsonl when the profiler was on), as
// Prepare-BenchRun.ps1 archives them. For every run with the profiler's
// summary in KSP.log, it also checks that KSP.log alone gives the same
// findings as the .jsonl. Prints one line per run and exits with 1 when any
// run fails or the file is invalid.
//
// It also runs the page's analyzer (dist/page/analyzer.bundle.js, the code the
// report template carries) on each run's files packed as the mod packs them,
// in a context with web APIs only, and checks it gives the CLI's report and page.

import { readdirSync, readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { buildRun } from "../core/run.js";
import { analyzeRun } from "../core/model.js";
import { installedMods } from "../core/mods.js";
import { SUMMARY_FORMAT } from "../core/summary.js";
import { unlistedMods, type Finding } from "../core/findings/index.js";
import { buildReport, checkReport } from "../report/model.js";
import { buildRaw } from "../report/raw.js";
import { renderHtml } from "../report/html.js";
import { reportRun } from "../report/markdown.js";
import { redactor } from "../report/redact.js";
import { renderSummary, SUMMARY_LIMIT } from "../report/text.js";
import { failures, parseExpectations, type Expectations } from "./expectations.js";
import { runInputs, runJsonl } from "./inputs.js";
import { INPUTS_SLOT, parseInputs, type Inputs } from "../page/inputs.js";
import { gunzipSync } from "node:zlib";
import { runInNewContext } from "node:vm";
import { fileURLToPath } from "node:url";

function runDirs(dir: string): string[] {
  return readdirSync(dir)
    .map((d) => join(dir, d))
    .filter((d) => existsSync(join(d, "KSP.log")))
    .sort();
}

const [file, ...extra] = process.argv.slice(2);
if (!file || extra.length) {
  console.error("Usage: node tools/analyze/dist/cli/check-archived.js <expectations.json>");
  process.exit(1);
}

let expectations: Expectations;
try {
  expectations = parseExpectations(readFileSync(file, "utf8"));
} catch (e) {
  console.error((e as Error).message);
  process.exit(1);
}

interface PageAnalyzer {
  analyzeInputs(inputs: Inputs): Promise<{ report: unknown; page: string }>;
}
const web = globalThis as unknown as Record<string, unknown>;
const pageAnalyzer = runInNewContext(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "page", "analyzer.bundle.js"), "utf8"), {
  atob: web.atob,
  Blob: web.Blob,
  DecompressionStream: web.DecompressionStream,
  Response: web.Response,
  TextDecoder: web.TextDecoder,
}) as PageAnalyzer;

const fromBase64 = (b64: string): Uint8Array => {
  const binary = (web.atob as (s: string) => string)(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
};
const startsWith = (whole: Uint8Array, part: Uint8Array) => part.length <= whole.length && part.every((b, i) => whole[i] === b);

/** Checks the report.html the mod wrote: one inputs block, holding prefixes of the archived files, that the page analyzes. */
async function modReport(runDir: string): Promise<{ problem?: string; note?: string }> {
  const html = readFileSync(join(runDir, "report.html"), "utf8");
  const blocks = [...html.matchAll(/<script type="application\/json" id="tminus-inputs">(\{[\s\S]*?)<\/script>/g)];
  if (blocks.length !== 1) return { problem: `${blocks.length} inputs blocks` };
  if (html.includes(INPUTS_SLOT)) return { problem: "the template's slot is still there" };
  let inputs: Inputs;
  try {
    inputs = parseInputs(blocks[0][1]);
  } catch (e) {
    return { problem: (e as Error).message };
  }
  if (/[\\/:]/.test(inputs.name)) return { problem: `its name looks like a path: ${inputs.name}` };
  const unpacked = (b64: string) => gunzipSync(fromBase64(b64));
  const log = unpacked(inputs.log);
  const archivedLog = readFileSync(join(runDir, "KSP.log"));
  if (!startsWith(archivedLog, log)) return { problem: "its KSP.log is not a prefix of the archived one" };
  const jsonlPath = runJsonl(runDir);
  if ((inputs.jsonl === undefined) !== (jsonlPath === undefined)) return { problem: "it has profiler records where the archive has none, or the reverse" };
  let jsonlNote = "";
  if (inputs.jsonl !== undefined && jsonlPath) {
    const jsonl = unpacked(inputs.jsonl);
    const archived = readFileSync(jsonlPath);
    if (!startsWith(archived, jsonl)) return { problem: "its .jsonl is not a prefix of the archived one" };
    jsonlNote = `, .jsonl ${Math.round((100 * jsonl.length) / archived.length)} %`;
  }
  try {
    await pageAnalyzer.analyzeInputs(inputs);
  } catch (e) {
    return { problem: `the page cannot analyze it: ${(e as Error).message}` };
  }
  return { note: `'${inputs.name}', KSP.log ${Math.round((100 * log.length) / archivedLog.length)} %${jsonlNote}` };
}

let failed = 0;
for (const suite of expectations.suites) {
  const dir = resolve(dirname(file), suite.runs);
  const runs = existsSync(dir) ? runDirs(dir) : [];
  if (!runs.length) {
    console.log(`FAIL ${suite.name}: no runs in ${dir}`);
    failed++;
    continue;
  }
  for (const runDir of runs) {
    const logText = readFileSync(join(runDir, "KSP.log"), "utf8");
    const jsonl = readdirSync(runDir).filter((f) => f.endsWith(".jsonl")).sort().pop();
    const jsonlText = jsonl ? readFileSync(join(runDir, jsonl), "utf8") : undefined;
    const run = buildRun(runDir, logText, jsonlText);
    const a = analyzeRun(run);
    const startTimed = run.records.some((r) => r.name === "addon.start");
    const logRun = buildRun(runDir, logText);
    const problems = failures(suite, { level: a.input.level, startTimed, summaryFormat: logRun.summaryFormat, holds: a.holds.map((h) => h.label), partDatabase: a.partDatabase, modFolders: [...new Set(installedMods(run).map((m) => m.folder))], findings: a.findings });

    // With the profiler's summary in KSP.log, KSP.log alone must give the same findings as the .jsonl.
    // Older summary formats lack lines that newer rules read: those runs are not compared.
    const logOnly = analyzeRun(logRun);
    const notes: string[] = [];
    if (jsonlText && logOnly.input.level === "log+summary" && (logRun.summaryFormat ?? 0) < SUMMARY_FORMAT)
      notes.push(`summary format ${logRun.summaryFormat}: not compared with the .jsonl`);
    else if (jsonlText && logOnly.input.level === "log+summary") {
      const key = (f: Finding) => `${f.id}|${f.subject ?? ""}|${f.where.phase}|${f.where.hold ?? ""}`;
      const fromJsonl = a.findings.map(key).sort().join("\n");
      const fromSummary = logOnly.findings.map(key).sort().join("\n");
      if (fromJsonl !== fromSummary) problems.push("the summary in KSP.log gives the same findings as the .jsonl");
    }
    // Every mod a finding's text names is in its mods list, which the report groups by.
    // A guess never sends the player to a mod's authors.
    for (const f of a.findings) {
      if (f.confidence === "heuristic" && f.remedy === "report") problems.push(`${f.id} is a guess that asks for a report to a mod's authors`);
      const missing = unlistedMods(run, f);
      if (missing.length) problems.push(`${f.id} lists the mods its text names (missing: ${missing.join(", ")})`);
    }
    // The report model's invariants: grouping, totals, limits, redaction.
    const report = buildReport(a);
    for (const broken of checkReport(report, a)) problems.push(`report: ${broken}`);
    // What the player shares: the page (with its raw data), the Markdown and the copied summary.
    const summary = renderSummary(report);
    if (summary.length > SUMMARY_LIMIT) problems.push(`summary: ${summary.length} characters, over ${SUMMARY_LIMIT}`);
    const leftover = redactor(a.identifying);
    const outputs = { html: renderHtml(report, { raw: buildRaw(a) }), markdown: reportRun(a).join("\n"), summary };
    for (const [name, text] of Object.entries(outputs)) {
      if (a.identifying.roots.some((root) => text.includes(root) || text.includes(JSON.stringify(root).slice(1, -1)))) problems.push(`${name}: an install root survives redaction`);
      else if (leftover(text) !== text) problems.push(`${name}: a string survives redaction`);
    }
    // The page, from the files as the mod embeds them, says what the CLI says.
    const fromPage = await pageAnalyzer.analyzeInputs(runInputs(runDir, runDir));
    if (JSON.stringify(fromPage.report) !== JSON.stringify(report)) problems.push("page: its report differs from the CLI's");
    else if (fromPage.page !== outputs.html) problems.push("page: its HTML differs from the CLI's");
    // The report the mod wrote in the session, when the archive has it: its
    // inputs are what the mod read of the session's files, and the page reads them.
    if (existsSync(join(runDir, "report.html"))) {
      const written = await modReport(runDir);
      if (written.problem) problems.push(`report.html: ${written.problem}`);
      else notes.push(`report.html: ${written.note}`);
    }
    failed += problems.length ? 1 : 0;
    const level = a.input.level === "log" ? "log only" : `${a.input.level}${startTimed ? ", Start timed" : ""}`;
    console.log(`${problems.length ? "FAIL" : "ok  "} ${suite.name} ${runDir} (${level}, ${a.findings.length} findings)${problems.map((f) => `\n     failed: ${f}`).join("")}${notes.map((n) => `\n     note: ${n}`).join("")}`);
  }
}
process.exit(failed ? 1 : 0);
