// T-Minus profiler analysis.
//
// Usage: node tools/analyze/dist/cli/analyze.js [--log-only] <run dir> [<run dir> ...]
//
// A run dir holds a KSP.log and, when the profiler was on, the run's .jsonl
// (Prepare-BenchRun.ps1 archives both to D:\KSP\bench-runs\<time>\).
// Prints a Markdown report: per run, then a comparison when several runs are
// given. --log-only ignores the .jsonl, to see what KSP.log alone (with the
// profiler's summary, when it has one) gives. Build first:
// npm --prefix tools/analyze run build.

import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, basename } from "node:path";
import { buildRun, type Run } from "../core/run.js";
import { analyzeRun, compareRuns } from "../core/model.js";
import { renderReport } from "../report/markdown.js";

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
const dirs = args.filter((a) => a !== "--log-only");
if (!dirs.length) {
  console.error("Usage: node tools/analyze/dist/cli/analyze.js [--log-only] <run dir> [<run dir> ...]");
  process.exit(1);
}
const runs = dirs.map((d) => loadRun(d, logOnly));
console.log(renderReport(runs.map(analyzeRun), runs.length > 1 ? compareRuns(runs) : undefined));
