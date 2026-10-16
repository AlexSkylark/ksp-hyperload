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
    const diagnostic = run.records.some((r) => r.name === "addon.start");
    const logRun = buildRun(runDir, logText);
    const problems = failures(suite, { level: a.input.level, diagnostic, summaryFormat: logRun.summaryFormat, holds: a.holds.map((h) => h.label), partDatabase: a.partDatabase, modFolders: [...new Set(installedMods(run).map((m) => m.folder))], findings: a.findings });

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
    for (const f of a.findings) {
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
    failed += problems.length ? 1 : 0;
    const level = a.input.level === "log" ? "log only" : `${a.input.level}${diagnostic ? ", diagnostic" : ""}`;
    console.log(`${problems.length ? "FAIL" : "ok  "} ${suite.name} ${runDir} (${level}, ${a.findings.length} findings)${problems.map((f) => `\n     failed: ${f}`).join("")}${notes.map((n) => `\n     note: ${n}`).join("")}`);
  }
}
process.exit(failed ? 1 : 0);
