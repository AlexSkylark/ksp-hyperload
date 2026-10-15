// The findings engine: runs the catalog's rules on a run and ranks what they find.

import type { Run } from "../run.js";
import type { Facts, Finding, InputLevel, Rule } from "./types.js";
import { mmCacheNotSaved } from "./mm-cache.js";
import { dragCubesRegenerated } from "./drag-cubes.js";
import { kspcfOptimizationOff } from "./kspcf-setting.js";
import { longStallByMod } from "./long-stall.js";
import { expensiveAddon } from "./addon-cost.js";
import { partParsingByMod } from "./part-parsing.js";

export type { Cost, Evidence, Facts, Finding, InputLevel, Rule } from "./types.js";

/** The catalog, in no particular order (findings are ranked by cost). */
const RULES: Rule[] = [mmCacheNotSaved, dragCubesRegenerated, kspcfOptimizationOff, longStallByMod, expensiveAddon, partParsingByMod];

/** What the profiler adds beyond its rules, said in log-only reports. */
const PROFILER_ADDS = [
  "exact Countdown and Hold boundaries for every scene (KSP.log only delimits space center and flight entry)",
  "long frames, so stalls are found in the Countdown and every Hold, counting gaps down to 0.5 s",
];

export function inputLevel(run: Run): InputLevel {
  return run.profilerOn ? "log+profiler" : "log";
}

/** What the missing input would add; empty when nothing is missing. */
export function missingInput(level: InputLevel): string[] {
  if (level === "log+profiler") return [];
  return [...PROFILER_ADDS, ...RULES.filter((r) => r.needs === "profiler").map((r) => r.detects)];
}

/** Largest known cost first; then findings with no number; informational ones last. */
function rank(a: Finding, b: Finding): number {
  const group = (f: Finding) => (f.informational ? 2 : f.cost.seconds === undefined ? 1 : 0);
  return group(a) - group(b) || (b.cost.seconds ?? 0) - (a.cost.seconds ?? 0);
}

export function findings(run: Run, facts: Facts): Finding[] {
  const level = facts.input.level;
  return RULES.filter((r) => r.needs === "log" || level === "log+profiler")
    .flatMap((r) => r.run(run, facts))
    .sort(rank);
}
