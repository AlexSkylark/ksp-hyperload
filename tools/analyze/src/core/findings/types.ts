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
   * not-measured: no number from this install (the method says why; never an outside figure).
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

/**
 * Where a cost falls. hold is the Hold's label, e.g. "EDITOR->FLIGHT"; a
 * "hold" with no label falls in Holds the analysis cannot name.
 */
export interface Where {
  phase: "countdown" | "hold" | "session";
  hold?: string;
}

/** One place's share of a finding's cost. */
export interface Place {
  where: Where;
  seconds: number;
}

/**
 * A mod a finding names, for grouping by mod. Only installed mods and
 * assemblies: never stock KSP, T-Minus, a KSPCF patch name or a file path.
 */
export interface ModRef {
  /** The mod's short name: its assembly when the cost comes from code, else its GameData folder. */
  name: string;
  /** The GameData folder that ships it, when known. */
  folder?: string;
  /**
   * culprit: the finding's cost is this mod's alone;
   * shared: several named mods carry the cost together, in unknown parts;
   * candidate: this mod may be the cause; the evidence does not say for sure.
   */
  role: "culprit" | "shared" | "candidate";
}

export type Remedy = "fix" | "trade-off" | "report" | "none";

export interface Finding {
  /** Catalog id, e.g. "mm-cache-not-saved". */
  id: string;
  /** What happened. */
  title: string;
  /** Short label: the mod, file or setting the finding is about, when there is one. */
  subject?: string;
  /** The mods the finding names, for grouping by mod; empty or absent when it names none. */
  mods?: ModRef[];
  /** Where the cost falls; "session" when it falls in several places (see places). */
  where: Where;
  /** The cost by place, largest first, when the rule splits it; one entry when it all falls in one place. */
  places?: Place[];
  cost: Cost;
  evidence: Evidence[];
  /** What the player can do, with any trade-off. Never implies T-Minus fixes it. */
  action: string;
  /**
   * What costs the time, as a short noun phrase for the headline and the
   * copied summary ("ModuleManager patching from scratch"). Built from the
   * install's data only.
   */
  cause: string;
  /**
   * fix: the player can remove the cost;
   * trade-off: the player can remove it by giving something up;
   * report: only the mod's authors can change it (never on a heuristic finding:
   *   a guess must not send the player to a mod's authors);
   * none: nothing to change (informational).
   */
  remedy: Remedy;
  /** measured: the evidence shows it directly; heuristic: it is inferred (e.g. log-gap attribution). */
  confidence: "measured" | "heuristic";
  /** Informational findings have no problem to fix; the report lists them last. */
  informational?: boolean;
  /** Ids of findings this one follows from or explains. */
  related?: string[];
  /**
   * The id of a finding whose cost already contains this one's: this one
   * says whose part of it the time is. The report shows it apart and never
   * adds it to a total.
   */
  within?: string;
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
