// A finding: one diagnosed problem, with its cost, evidence and a suggested action.

import type { Run } from "../run.js";
import type { RunAnalysis } from "../model.js";

/**
 * What the analyzer was given: KSP.log only; KSP.log with the summary the
 * profiler writes into it; or KSP.log plus the profiler's .jsonl.
 */
export type InputLevel = "log" | "log+summary" | "log+profiler";

export interface Cost {
  /**
   * measured: read from the log or the profiler as is;
   * estimated: derived from them, with the method stated;
   * not-measured: no number from this install (the method may cite an outside figure).
   */
  kind: "measured" | "estimated" | "not-measured";
  seconds?: number;
  /** How the number was obtained, or why there is none. */
  method: string;
}

export interface Evidence {
  source: "log" | "profiler";
  /** KSP.log line number, for log evidence. */
  line?: number;
  text: string;
}

export interface Finding {
  /** Catalog id, e.g. "mm-cache-not-saved". */
  id: string;
  /** What happened. */
  title: string;
  /** Mod or file the finding names, when there is one. */
  subject?: string;
  /** Where the cost falls. hold is the Hold's label, e.g. "EDITOR->FLIGHT". */
  where: { phase: "countdown" | "hold" | "session"; hold?: string };
  cost: Cost;
  evidence: Evidence[];
  /** What the player can do, with any trade-off. Never implies T-Minus fixes it. */
  action: string;
  /** measured: the evidence shows it directly; heuristic: it is inferred (e.g. log-gap attribution). */
  confidence: "measured" | "heuristic";
  /** Informational findings have no problem to fix; the report lists them last. */
  informational?: boolean;
  /** Ids of findings this one follows from or explains. */
  related?: string[];
  /** Trade-offs, caveats, conditions. */
  notes?: string[];
}

/** The analysis a rule reads: everything except the findings themselves. */
export type Facts = Omit<RunAnalysis, "findings">;

export interface Rule {
  id: string;
  /** The input the rule needs; "profiler" rules are skipped at the log-only level. */
  needs: "log" | "profiler";
  /** What the rule detects, said in the report when it was skipped. */
  detects: string;
  run(run: Run, facts: Facts): Finding[];
}
