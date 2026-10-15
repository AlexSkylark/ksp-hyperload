// The findings engine: runs the catalog's rules on a run and ranks what they find.

import type { Run } from "../run.js";
import type { Facts, Finding, InputLevel, Rule } from "./types.js";
import { mmCacheNotSaved } from "./mm-cache.js";
import { dragCubesRegenerated } from "./drag-cubes.js";
import { kspcfOptimizationOff } from "./kspcf-setting.js";
import { longStallByMod } from "./long-stall.js";
import { expensiveAddon } from "./addon-cost.js";
import { partParsingByMod } from "./part-parsing.js";

export type { Cost, Evidence, Facts, Finding, InputLevel, Place, Rule, Where } from "./types.js";

/** The catalog, in no particular order (findings are ranked by cost). */
const RULES: Rule[] = [mmCacheNotSaved, dragCubesRegenerated, kspcfOptimizationOff, longStallByMod, expensiveAddon, partParsingByMod];

/** What the profiler adds beyond its rules, said in reports from KSP.log without the profiler's summary. */
const PROFILER_ADDS = [
  "exact Countdown and Hold boundaries for every scene (KSP.log only delimits space center and flight entry)",
  "long frames, so stalls are found in the Countdown and every Hold, counting gaps down to 0.5 s",
];

/** What the .jsonl adds over the summary the profiler writes to KSP.log. */
const JSONL_ADDS = [
  "every addon and part folder (the summary keeps the ten costliest of each per Countdown or Hold)",
  "GameEvent, ScenarioModule and memory records",
];

export function inputLevel(run: Run): InputLevel {
  if (!run.profilerOn) return "log";
  return run.recordsFrom === "summary" ? "log+summary" : "log+profiler";
}

/** What the missing input would add; empty when nothing is missing. */
export function missingInput(level: InputLevel): string[] {
  if (level === "log+profiler") return [];
  if (level === "log+summary") return JSONL_ADDS;
  return [...PROFILER_ADDS, ...RULES.filter((r) => r.needs === "profiler").map((r) => r.detects)];
}

/** Largest known cost first; then findings with no number; informational ones last. */
function rank(a: Finding, b: Finding): number {
  const group = (f: Finding) => (f.informational ? 2 : f.cost.seconds === undefined ? 1 : 0);
  return group(a) - group(b) || (b.cost.seconds ?? 0) - (a.cost.seconds ?? 0);
}

export function findings(run: Run, facts: Facts): Finding[] {
  const level = facts.input.level;
  return RULES.filter((r) => r.needs === "log" || level !== "log")
    .flatMap((r) => r.run(run, facts))
    .sort(rank);
}
