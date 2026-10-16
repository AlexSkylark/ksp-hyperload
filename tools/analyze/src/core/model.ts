// The model: what a run says about the Countdown (startup) and each Hold
// (scene transition), computed from the parsed log and profiler records.
// Lists are complete and sorted; picking the top N is the report's job.

import { DECIMAL, decimal, type LogLine } from "./log.js";
import type { Run } from "./run.js";
import { assetLoads, type AssetLoads } from "./assets.js";
import { countdownPhases, flightEntries, mmBreakdown, type FlightEntry, type MmBreakdown, type Phase } from "./phases.js";
import { identifying, system, type Identifying, type System } from "./identity.js";
import { findings, inputLevel, missingInput, type Finding, type InputLevel } from "./findings/index.js";
import { gaps, LONG_FRAME_MS, MIN_GAP_SECONDS, phaseOf, sourceOf } from "./timeline.js";

const AGGREGATE_FAMILIES = [
  "addon.awake", "addon.start", "gameEvent.fire", "scenario.load", "part.parse.byMod", "partLoader.methods", "configNode.load",
  // Module dispatch (profiler hooks group moduleHooks). Levels nest: totals are inclusive.
  "module.load", "module.awake", "module.onStart", "module.onStartFinished",
  "vesselModule.awake", "vesselModule.start", "vesselModule.load",
  "part.load", "part.modulesOnStart", "part.modulesOnStartFinished", "part.initializeModules",
  "vessel.protoLoad", "vessel.load",
  // From the summary (format 3), which sums the module stages per type and per assembly.
  "module.byType", "module.byAssembly",
  // Coroutine steps (opt-in group coroutineHooks): steps no timed call encloses, the enclosed ones and the loaders' apart; per assembly from the summary.
  "coroutine.step", "coroutine.step.within", "coroutine.step.loading", "coroutine.byAssembly",
  // Harmony (group harmonyHooks): rebuilds of patched methods, by owner and by method.
  "harmony.patch", "harmony.unpatch", "harmony.target",
  // Per call (opt-in group harmonyCallHooks): time other mods' patches add to each method, and its body. Raw, calibration not subtracted.
  "harmony.call.patches", "harmony.call.body",
];

/**
 * [C] PartLoader reads PartDatabase.cfg at startup and writes it back on every
 * load, so only its log line tells a usable file from a new database
 * (docs/mechanisms.md, 3.2). "created": no file or one that does not parse;
 * "version-changed": the file is from another game version. Either way every
 * part without config-defined drag cubes gets them rendered again.
 */
export type PartDatabaseState = "loaded" | "created" | "version-changed";

export function partDatabaseState(run: Run): PartDatabaseState | undefined {
  for (const l of run.log) {
    if (!l.text.startsWith("PartLoader: ")) continue;
    if (l.text.includes("Version strings do not match")) return "version-changed";
    if (l.text.includes("Creating part database")) return "created";
    if (l.text.includes("Loading part database")) return "loaded";
  }
  return undefined;
}

export interface Hold {
  label: string;
  seconds: number;
  /** How "ready" was determined. */
  source: "profiler" | "ShowUI";
  /** KSP.log times (s) of the scene request and the ShowUI line; ShowUI Holds only. */
  logFrom?: number;
  logTo?: number;
}

export interface LongFrame {
  /** The scene the frame ran in, as the profiler recorded it. */
  label: string;
  /** Where the frame falls: in the Countdown, in a Hold (named), or between Holds. */
  phase: "countdown" | "hold" | "between";
  hold?: string;
  seconds: number;
  /** Sum of the log gaps inside the frame. */
  gapSeconds: number;
  /** Time inside the profiler's timed hooks, when the profiler recorded it; the rest is unattributed. */
  coveredSeconds?: number;
  /** Gaps grouped by the source(s) of the log lines around them, largest first; empty when there is no gap. */
  around: { source: string; gaps: number; seconds: number }[];
}

export interface RunAnalysis {
  name: string;
  version: string;
  profilerOn: boolean;
  input: {
    level: InputLevel;
    /** What the missing input would add; empty when nothing is missing. */
    missing: string[];
  };
  /** The hardware KSP.log's header names; undefined when it has none. */
  system?: System;
  /** What in KSP.log identifies the player, the install or the save: for redaction, never for display. */
  identifying: Identifying;
  /** From the profiler's run header. Values are as recorded (possibly missing). */
  install?: { kspcf?: string; kspcfTextureCache?: boolean; assemblyCount?: number; uptimeAtStartHours: number };
  /** From the profiler's conditions record. */
  conditions?: { mmCache: string };
  /**
   * KSPCF's settings as the profiler read them at the main menu: the number of
   * KSP_COMMUNITY_FIXES nodes (KSPCF reads them only when there is one; the
   * summary lists only more than one, so 1 stands for "not more"), and each
   * key whose effective value differs from the installed Settings.cfg
   * ("Key: installed -> effective", "+Key = value", "-Key"). Undefined when the
   * profiler did not record them.
   */
  kspcfSettings?: { nodes: number; changed: string[] };
  /** How PartLoader got its database this startup, from KSP.log; undefined when the log does not say. */
  partDatabase?: PartDatabaseState;
  countdown: {
    metrics: { label: string; seconds?: number }[];
    loaders: { name: string; approx: boolean; seconds: number }[];
    /** The main menu scene switch, request to ready: the Countdown's last stretch (profiler only). */
    mainMenu?: Hold;
    /** Per-file asset loads, from KSP.log (inferred from log timestamps); undefined when the log has no per-file line. */
    assets?: AssetLoads;
    /** Coarse phases from KSP.log's own lines, at every input level; undefined without the main menu's scene change. */
    phases?: Phase[];
    /** ModuleManager's part, from KSP.log and its dump. */
    moduleManager?: MmBreakdown;
  };
  /** Scene transitions after the Countdown. */
  holds: Hold[];
  /** Each flight entry's phases, from KSP.log. */
  flightEntries: FlightEntry[];
  /** Undefined when profiler time cannot be anchored to log time. */
  longFrames?: LongFrame[];
  /** Whole-session totals per family, largest first; families with no entries are left out. */
  aggregates: { family: string; entries: { key: string; ms: number }[] }[];
  /** Slowest single GameEvent dispatches, largest first. */
  slowEvents: { event: string; ms: number }[];
  /** Ranked: largest known cost first. */
  findings: Finding[];
}

export interface Stats {
  mean: number;
  min: number;
  max: number;
  n: number;
}

export interface Comparison {
  /** Group keys in order of first appearance: "on" / "off" (profiler). */
  groups: string[];
  rows: { metric: string; byGroup: Map<string, Stats> }[];
}

// ---------------------------------------------------------------- Countdown

function logNumber(run: Run, pattern: RegExp): number | undefined {
  for (const l of run.log) {
    const m = pattern.exec(l.text);
    if (m) return decimal(m[1]);
  }
  return undefined;
}

function countdownMetrics(run: Run): { label: string; seconds?: number }[] {
  const first = run.log[0]?.t ?? 0;
  const menuSwitch = run.log.find((l) => l.text.includes("Scene Change : From LOADING to MAINMENU"));
  const ready = run.records.find((r) => r.kind === "span" && r.name === "scene.transition" && r.detail === "LOADING->MAINMENU");
  return [
    { label: "Loading Systems (KSP)", seconds: logNumber(run, new RegExp(`Loading Systems: Elapsed time is (${DECIMAL})s`)) },
    { label: "MM Total loading Time", seconds: logNumber(run, new RegExp(String.raw`\[ModuleManager\] Total loading Time = (${DECIMAL})s`)) },
    { label: "Main menu scene switch (since log start)", seconds: menuSwitch ? menuSwitch.t - first : undefined },
    { label: "Main menu ready (since process start)", seconds: ready ? (ready.t + ready.dur) / 1000 : undefined },
  ];
}

// ---------------------------------------------------------------- Holds

/**
 * Holds from the profiler, or from KSP's ShowUI line when it was off
 * (or when forced, to compare profiler-on runs with profiler-off runs).
 */
export function holds(run: Run, source: "auto" | "ShowUI" = "auto"): Hold[] {
  if (run.profilerOn && source === "auto") {
    return run.records
      .filter((r) => r.kind === "span" && r.name === "scene.transition")
      .map((r) => ({ label: r.detail, seconds: r.dur / 1000, source: "profiler" as const }));
  }
  // [C] LoadingBufferMask.Hide calls UIMasterController.ShowUI, which logs
  // "[UIMasterController]: ShowUI": same millisecond as the profiler's marker
  // for SPACECENTER and FLIGHT. Other scenes log ShowUI too early to use.
  const result: Hold[] = [];
  let pending: { label: string; t: number } | undefined;
  for (const l of run.log) {
    const m = /Scene Change : From (\w+) to (\w+)/.exec(l.text);
    if (m) {
      pending = m[2] === "SPACECENTER" || m[2] === "FLIGHT" ? { label: `${m[1]}->${m[2]}`, t: l.t } : undefined;
    } else if (pending && l.text.includes("[UIMasterController]: ShowUI")) {
      result.push({ label: pending.label, seconds: l.t - pending.t, source: "ShowUI", logFrom: pending.t, logTo: l.t });
      pending = undefined;
    }
  }
  return result;
}

// ---------------------------------------------------------------- long frames and log gaps

function longFrames(run: Run): LongFrame[] | undefined {
  if (run.processStartLogT === undefined) return undefined;
  const result: LongFrame[] = [];
  for (const f of run.records.filter((r) => r.kind === "span" && r.name === "frame.long" && r.dur >= LONG_FRAME_MS)) {
    const from = run.processStartLogT + f.t / 1000;
    const to = from + f.dur / 1000;
    const g = gaps(run, from, to, MIN_GAP_SECONDS).sort((a, b) => b.seconds - a.seconds);
    const gapSeconds = g.reduce((s, x) => s + x.seconds, 0);
    // Group by the pair of sources around each gap.
    const bySource = new Map<string, { gaps: number; seconds: number }>();
    for (const x of g) {
      const a = sourceOf(x.before.text), b = sourceOf(x.after.text);
      const key = a === b ? a : `${a} → ${b}`;
      const e = bySource.get(key) ?? { gaps: 0, seconds: 0 };
      e.seconds += x.seconds;
      e.gaps++;
      bySource.set(key, e);
    }
    const around = [...bySource]
      .sort((a, b) => b[1].seconds - a[1].seconds)
      .map(([source, e]) => ({ source, gaps: e.gaps, seconds: e.seconds }));
    const covered = typeof f.covered === "number" ? { coveredSeconds: f.covered / 1000 } : {};
    result.push({ label: f.detail, ...phaseOf(run, f.t, f.dur), seconds: f.dur / 1000, gapSeconds, ...covered, around });
  }
  return result;
}

// ---------------------------------------------------------------- run

export function analyzeRun(run: Run): RunAnalysis {
  const header = run.records.find((r) => r.kind === "run");
  const conditions = run.records.find((r) => r.kind === "conditions");
  const summaryFacts = run.records.find((r) => r.kind === "facts");
  const kspcfSettings =
    conditions?.kspcfSettingsChanged !== undefined
      ? { nodes: conditions.kspcfSettingsNodes ?? 1, changed: conditions.kspcfSettingsChanged as string[] }
      : summaryFacts
        ? { nodes: summaryFacts.kspcfSettingsNodes ?? 1, changed: summaryFacts.kspcfSettingsChanged as string[] }
        : undefined;

  const aggregates: RunAnalysis["aggregates"] = [];
  for (const family of AGGREGATE_FAMILIES) {
    const totals = new Map<string, number>();
    for (const r of run.records.filter((r) => r.kind === "aggregate" && r.name === family && !String(r.detail).startsWith("(other")))
      totals.set(r.detail, (totals.get(r.detail) ?? 0) + r.total);
    if (!totals.size) continue;
    aggregates.push({ family, entries: [...totals].sort((a, b) => b[1] - a[1]).map(([key, ms]) => ({ key, ms })) });
  }

  const level = inputLevel(run);
  const allHolds = holds(run);
  const facts: Omit<RunAnalysis, "findings"> = {
    name: run.name,
    version: run.version,
    profilerOn: run.profilerOn,
    input: { level, missing: missingInput(level) },
    system: system(run),
    identifying: identifying(run),
    install: header && {
      kspcf: header.kspcf,
      // The conditions record has the value at the main menu, after KSPCF asked; older files only have the startup value.
      kspcfTextureCache: conditions?.kspcfTextureCache ?? header.kspcfTextureCache,
      assemblyCount: header.assemblyCount,
      uptimeAtStartHours: header.uptimeAtProcessStartMs / 3600000,
    },
    conditions: conditions && { mmCache: conditions.mmCache },
    kspcfSettings,
    partDatabase: partDatabaseState(run),
    countdown: {
      metrics: countdownMetrics(run),
      loaders: run.records
        .filter((r) => r.kind === "span" && r.name === "loader")
        .map((r) => ({ name: r.detail, approx: Boolean(r.approx), seconds: r.dur / 1000 })),
      mainMenu: allHolds.find((h) => h.label === "LOADING->MAINMENU"),
      assets: assetLoads(run),
      phases: countdownPhases(run),
      moduleManager: mmBreakdown(run),
    },
    flightEntries: flightEntries(run),
    holds: allHolds.filter((h) => h.label !== "LOADING->MAINMENU"),
    longFrames: longFrames(run),
    aggregates,
    slowEvents: run.records
      .filter((r) => r.kind === "span" && r.name === "gameEvent.slow")
      .sort((a, b) => b.dur - a.dur)
      .map((r) => ({ event: r.detail, ms: r.dur })),
  };
  return { ...facts, findings: findings(run, facts) };
}

// ---------------------------------------------------------------- comparison

function stats(values: number[]): Stats {
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  return { mean, min: Math.min(...values), max: Math.max(...values), n: values.length };
}

/** Countdown metrics and Holds across runs, grouped by profiler on/off. */
export function compareRuns(runs: Run[]): Comparison {
  const groups = new Map<string, Run[]>();
  for (const r of runs) {
    const key = r.profilerOn ? "on" : "off";
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }

  const values = new Map<string, Map<string, number[]>>(); // metric -> group -> values
  const add = (metric: string, group: string, v: number | undefined) => {
    if (v === undefined) return;
    const m = values.get(metric) ?? new Map<string, number[]>();
    m.set(group, [...(m.get(group) ?? []), v]);
    values.set(metric, m);
  };
  for (const [group, rs] of groups)
    for (const r of rs) {
      for (const m of countdownMetrics(r)) add(m.label, group, m.seconds);
      // ShowUI exists with the profiler on and off, so these compare fairly.
      for (const h of holds(r, "ShowUI")) add(h.label, group, h.seconds);
    }

  const rows = [...values].map(([metric, byGroup]) => ({
    metric,
    byGroup: new Map([...byGroup].map(([g, v]) => [g, stats(v)] as const)),
  }));
  return { groups: [...groups.keys()], rows };
}
