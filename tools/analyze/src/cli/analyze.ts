// T-Minus profiler analysis.
//
// Usage: node tools/analyze/dist/cli/analyze.js <run dir> [<run dir> ...]
//
// A run dir holds a KSP.log and, when the profiler was on, the run's .jsonl
// (Prepare-BenchRun.ps1 archives both to D:\KSP\bench-runs\<time>\).
// Prints a Markdown report: per run, then a comparison when several runs are
// given. Build first: npm --prefix tools/analyze run build.

import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, basename } from "node:path";
import { buildRun, type Run } from "../core/run.js";
import { analyzeRun, compareRuns } from "../core/model.js";
import { renderReport } from "../report/markdown.js";

function loadRun(dir: string): Run {
  const logPath = join(dir, "KSP.log");
  if (!existsSync(logPath)) throw new Error(`no KSP.log in ${dir}`);
  const logText = readFileSync(logPath, "utf8");
  const jsonl = readdirSync(dir).filter((f) => f.endsWith(".jsonl")).sort().pop();
  const jsonlText = jsonl ? readFileSync(join(dir, jsonl), "utf8") : undefined;
  return buildRun(basename(dir), logText, jsonlText);
}

const dirs = process.argv.slice(2);
if (!dirs.length) {
  console.error("Usage: node tools/analyze/dist/cli/analyze.js <run dir> [<run dir> ...]");
  process.exit(1);
}
const runs = dirs.map(loadRun);
console.log(renderReport(runs.map(analyzeRun), runs.length > 1 ? compareRuns(runs) : undefined));
