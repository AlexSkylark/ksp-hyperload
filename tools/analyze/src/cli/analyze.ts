// T-Minus profiler analysis.
//
// Usage: node tools/analyze/dist/cli/analyze.js [--log-only] [--html <file>] <run dir> [<run dir> ...]
//
// A run dir holds a KSP.log and, when the profiler was on, the run's .jsonl
// (Prepare-BenchRun.ps1 archives both to D:\KSP\bench-runs\<time>\).
// Prints a Markdown report: per run, then a comparison when several runs are
// given. --log-only ignores the .jsonl, to see what KSP.log alone (with the
// profiler's summary, when it has one) gives. --html also writes the first
// run's report page, with its Raw data, to <file>. Build first:
// npm --prefix tools/analyze run build.

import { readdirSync, readFileSync, existsSync, writeFileSync } from "node:fs";
import { join, basename } from "node:path";
import { buildRun, type Run } from "../core/run.js";
import { analyzeRun, compareRuns } from "../core/model.js";
import { renderReport } from "../report/markdown.js";
import { buildReport } from "../report/model.js";
import { buildRaw } from "../report/raw.js";
import { renderHtml } from "../report/html.js";

function loadRun(dir: string, logOnly: boolean): Run {
  const logPath = join(dir, "KSP.log");
  if (!existsSync(logPath)) throw new Error(`no KSP.log in ${dir}`);
  const logText = readFileSync(logPath, "utf8");
  const jsonl = logOnly ? undefined : readdirSync(dir).filter((f) => f.endsWith(".jsonl")).sort().pop();
  const jsonlText = jsonl ? readFileSync(join(dir, jsonl), "utf8") : undefined;
  return buildRun(basename(dir), logText, jsonlText);
}

const args = process.argv.slice(2);
const logOnly = args.includes("--log-only");
const htmlAt = args.indexOf("--html");
const htmlPath = htmlAt >= 0 ? args[htmlAt + 1] : undefined;
const dirs = args.filter((a, i) => a !== "--log-only" && i !== htmlAt && (htmlAt < 0 || i !== htmlAt + 1));
if (!dirs.length) {
  console.error("Usage: node tools/analyze/dist/cli/analyze.js [--log-only] [--html <file>] <run dir> [<run dir> ...]");
  process.exit(1);
}
const runs = dirs.map((d) => loadRun(d, logOnly));
const analyses = runs.map(analyzeRun);
console.log(renderReport(analyses, runs.length > 1 ? compareRuns(runs) : undefined));
if (htmlPath) writeFileSync(htmlPath, renderHtml(buildReport(analyses[0]), { raw: buildRaw(analyses[0]) }), "utf8");
