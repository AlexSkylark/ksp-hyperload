// Checks the findings on archived runs against what Phase 1 established.
//
// Usage: node tools/analyze/dist/cli/check-archived.js --bench <dir> [--dev <dir>]
//
// Each <dir> holds one folder per run (KSP.log, and the .jsonl when the
// profiler was on), as Prepare-BenchRun.ps1 archives them. Expectations:
// docs/phase2-decision.md (KSP-bench) and a stock install for KSP-dev.
// Prints one line per run and exits with 1 when any run fails.

import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { buildRun } from "../core/run.js";
import { analyzeRun, type RunAnalysis } from "../core/model.js";
import type { Finding } from "../core/findings/index.js";

type Check = [string, (fs: Finding[]) => boolean];

const has = (id: string, test: (f: Finding) => boolean = () => true) => (fs: Finding[]) => fs.some((f) => f.id === id && test(f));
const not = (check: (fs: Finding[]) => boolean) => (fs: Finding[]) => !check(fs);

const BENCH: Check[] = [
  ["MM cache: 4 errors in ChemicalPropulsion", has("mm-cache-not-saved", (f) => f.subject === "ChemicalPropulsion" && f.evidence.some((e) => e.text.startsWith("4 errors related to GameData/ChemicalPropulsion/Patches/Compatibility/chemical-propulsion-NearFutureSpacecraft.cfg")))],
  ["drag cubes: 1650 parts, every startup", has("drag-cubes-regenerated", (f) => /for 1650 parts on every startup/.test(f.title))],
  ["ForceSyncSceneSwitch off, UniversalStorage2 a candidate", has("kspcf-optimization-off", (f) => f.subject === "ForceSyncSceneSwitch" && /UniversalStorage2/.test(f.title))],
];
/** Runs that entered flight (early runs followed other routes, one never launched). */
const BENCH_FLIGHT: Check[] = [
  ["ProgressiveCBMaps stalls flight entry", has("long-stall-by-mod", (f) => f.subject === "ProgressiveCBMaps (REPOSoftTech)" && (f.places ?? []).some((p) => /->FLIGHT$/.test(p.where.hold ?? "")))],
];
const BENCH_PROFILER: Check[] = [
  ["ResearchBodies stalls the main menu (Countdown)", has("long-stall-by-mod", (f) => f.subject === "ResearchBodies (REPOSoftTech)" && f.where.phase === "countdown")],
  ["Kopernicus.Injector Awake", has("expensive-addon", (f) => f.subject === "Kopernicus" && /Kopernicus\.Injector/.test(f.title))],
  ["part compilation, informational", has("part-parsing-by-mod", (f) => Boolean(f.informational))],
];
const BENCH_DIAGNOSTIC: Check[] = [["ProgressiveCBMaps.VisualMaps Start ~41 s", has("expensive-addon", (f) => /Start: ProgressiveCBMaps\.VisualMaps/.test(f.title) && (f.cost.seconds ?? 0) > 30)]];
const BENCH_LOG_ONLY: Check[] = [
  ["no profiler findings", not((fs) => fs.some((f) => f.id === "expensive-addon" || f.id === "part-parsing-by-mod"))],
  ["no Countdown stall", not(has("long-stall-by-mod", (f) => f.where.phase === "countdown"))],
];
const DEV: Check[] = [["no findings (stock, no KSPCF, no MM)", (fs) => fs.length === 0]];

function checksFor(kind: "bench" | "dev", a: RunAnalysis, diagnostic: boolean): Check[] {
  if (kind === "dev") return DEV;
  const bench = [...BENCH, ...(a.holds.some((h) => h.label.endsWith("->FLIGHT")) ? BENCH_FLIGHT : [])];
  if (a.input.level === "log") return [...bench, ...BENCH_LOG_ONLY];
  return [...bench, ...BENCH_PROFILER, ...(diagnostic ? BENCH_DIAGNOSTIC : [])];
}

function runDirs(dir: string): string[] {
  return readdirSync(dir)
    .map((d) => join(dir, d))
    .filter((d) => existsSync(join(d, "KSP.log")))
    .sort();
}

const args = process.argv.slice(2);
const dirs: { kind: "bench" | "dev"; dir: string }[] = [];
for (let i = 0; i < args.length; i += 2) {
  const kind = args[i] === "--bench" ? "bench" : args[i] === "--dev" ? "dev" : undefined;
  if (!kind || !args[i + 1]) {
    console.error("Usage: node tools/analyze/dist/cli/check-archived.js --bench <dir> [--dev <dir>]");
    process.exit(1);
  }
  dirs.push({ kind, dir: args[i + 1] });
}

let failed = 0;
for (const { kind, dir } of dirs) {
  for (const run of runDirs(dir)) {
    const jsonl = readdirSync(run).filter((f) => f.endsWith(".jsonl")).sort().pop();
    const jsonlText = jsonl ? readFileSync(join(run, jsonl), "utf8") : undefined;
    const a = analyzeRun(buildRun(run, readFileSync(join(run, "KSP.log"), "utf8"), jsonlText));
    const diagnostic = jsonlText?.includes('"name":"addon.start"') ?? false;
    const failures = checksFor(kind, a, diagnostic).filter(([, check]) => !check(a.findings)).map(([name]) => name);

    // With the profiler's summary in KSP.log, KSP.log alone must give the same findings as the .jsonl.
    const logOnly = analyzeRun(buildRun(run, readFileSync(join(run, "KSP.log"), "utf8")));
    if (jsonlText && logOnly.input.level === "log+summary") {
      const key = (f: Finding) => `${f.id}|${f.subject ?? ""}|${f.where.phase}|${f.where.hold ?? ""}`;
      const fromJsonl = a.findings.map(key).sort().join("\n");
      const fromSummary = logOnly.findings.map(key).sort().join("\n");
      if (fromJsonl !== fromSummary) failures.push("the summary in KSP.log gives the same findings as the .jsonl");
    }
    failed += failures.length ? 1 : 0;
    const level = a.input.level === "log" ? "log only" : diagnostic ? "profiler, diagnostic" : "profiler";
    console.log(`${failures.length ? "FAIL" : "ok  "} ${kind} ${run} (${level}, ${a.findings.length} findings)${failures.map((f) => `\n     missing: ${f}`).join("")}`);
  }
}
process.exit(failed ? 1 : 0);
