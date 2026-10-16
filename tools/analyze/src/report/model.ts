// The report model: what the player reads, built from the analysis.
// Pure (no Node, no DOM) and serializable, so the CLI and the page render the
// same thing. Decisions: docs/m6-web-plan.md, "Report model: shape and
// decisions". Findings are listed once (Report.findings) and referenced by
// index everywhere else.

import type { RunAnalysis } from "../core/model.js";
import type { MmBreakdown } from "../core/phases.js";
import type { System } from "../core/identity.js";
import type { Finding, InputLevel, ModRef, Place, Remedy, Where } from "../core/findings/index.js";
import { redactor, type Redact } from "./redact.js";
import { holdName, LEVEL_NAME } from "./wording.js";

/** Model format: bump when a field changes meaning. */
export const REPORT_FORMAT = 1;
/** Groups and Hold costs shown before "the rest". */
export const TOP = 10;
/** Points of attention per part, at most; and the count the list is filled up to. */
export const MAX_POINTS = 5;
export const MIN_POINTS = 3;
/** Evidence kept per finding, and the length of each line. */
export const EVIDENCE_LINES = 3;
export const EVIDENCE_CHARS = 160;
/**
 * A likely cost weighs half a measured one when points are ranked by impact:
 * a measurement goes first when it is at least half the guess's size, since a
 * guess from log gaps can be off by its whole amount (design, "Thresholds").
 */
export const LIKELY_WEIGHT = 0.5;

/** measured: the number is read as is; likely: estimated or inferred. */
export type Certainty = "measured" | "likely";
/** The report's two parts: startup, and the scene transitions after it. */
export type Part = "countdown" | "holds";

export interface ReportFinding {
  id: string;
  title: string;
  cause: string;
  remedy: Remedy;
  subject?: string;
  mods: ModRef[];
  /** Undefined when there is no number. */
  seconds?: number;
  certainty?: Certainty;
  /** How the number was obtained, or why there is none. */
  method: string;
  places: Place[];
  /** The parts the finding falls in. */
  parts: Part[];
  /** At most EVIDENCE_LINES lines of at most EVIDENCE_CHARS, redacted. */
  evidence: { source: "log" | "profiler"; line?: number; text: string }[];
  /** Evidence lines left out. */
  moreEvidence: number;
  action: string;
  notes: string[];
  informational: boolean;
  /** Indexes of the findings this one follows from (its related ids), and of those that follow from it. */
  follows: number[];
  followers: number[];
}

/** Several findings' costs, shown apart: measured and likely seconds are never added in the text. */
export interface Totals {
  measured: number;
  likely: number;
}

export interface ModGroup extends Totals {
  /** Stable key: the mod's name, "mods:" plus the names, or "install:" plus the finding id. */
  key: string;
  /** mod: one mod; mods: one finding naming several; install: no mod. */
  kind: "mod" | "mods" | "install";
  /** "RealChute"; "A or B" (candidates), "A and B" (shared); the finding's cause for install groups. */
  name: string;
  /** The GameData folder, when it differs from the name. */
  folder?: string;
  /** Finding indexes, ranked by their seconds in the part. */
  findings: number[];
}

export interface Ranked<T> {
  top: T[];
  /** What is left after the top ones; undefined when nothing is. */
  rest?: Totals & { count: number };
}

export interface HoldCost {
  finding: number;
  seconds: number;
  certainty: Certainty;
}

export interface HoldRow {
  label: string;
  name: string;
  seconds: number;
  /** profiler: request to ready; ShowUI: KSP's ShowUI line, without the profiler. */
  source: "profiler" | "ShowUI";
  costs: Ranked<HoldCost>;
  /** The Hold minus its measured costs (never below 0); likely costs fall inside it. */
  unmeasured: number;
  /** Likely costs in the Hold, shown as guesses inside the unmeasured rest. */
  likely: number;
}

export interface Stage {
  label: string;
  seconds: number;
  /** Mods' code runs in it. */
  modCode: boolean;
}

export interface Notice {
  text: string;
  items?: string[];
}

export interface Report {
  format: number;
  run: {
    /** The T-Minus build that wrote the profiler records. */
    tminusVersion: string;
    level: InputLevel;
    levelName: string;
    profilerOn: boolean;
    system?: System;
    kspcf?: string;
    assemblyCount?: number;
  };
  notices: Notice[];
  headline: {
    countdown?: { seconds: number; source: "profiler" | "log" };
    /** The largest cost the player can act on (fix or trade-off), with what follows from it. */
    top?: { finding: number; followers: number[]; seconds?: number; certainty?: Certainty; followersAdded: boolean };
  };
  countdown: {
    seconds?: number;
    source?: "profiler" | "log";
    points: number[];
    groups: Ranked<ModGroup>;
    stages: Stage[];
    moduleManager?: MmBreakdown;
  };
  holds: {
    points: number[];
    groups: Ranked<ModGroup>;
    rows: HoldRow[];
    flightEntries: { label: string; name: string; stages: Stage[] }[];
  };
  findings: ReportFinding[];
}

// ---------------------------------------------------------------- findings

export const certaintyOf = (f: Finding): Certainty | undefined =>
  f.cost.seconds === undefined ? undefined : f.cost.kind === "measured" && f.confidence === "measured" ? "measured" : "likely";

const partOf = (w: Where): Part => (w.phase === "countdown" ? "countdown" : "holds");

function partsOf(f: Finding): Part[] {
  const from = f.places?.length ? f.places.map((p) => partOf(p.where)) : f.where.phase === "session" ? (["countdown", "holds"] as Part[]) : [partOf(f.where)];
  return (["countdown", "holds"] as Part[]).filter((p) => from.includes(p));
}

/** A finding's seconds in a part: its places there, or its whole cost when it has no places. */
export function secondsIn(f: ReportFinding, part: Part): number | undefined {
  if (f.seconds === undefined || !f.parts.includes(part)) return undefined;
  if (!f.places.length) return f.seconds;
  return f.places.filter((p) => partOf(p.where) === part).reduce((s, p) => s + p.seconds, 0);
}

const clip = (s: string) => (s.length > EVIDENCE_CHARS ? `${s.slice(0, EVIDENCE_CHARS - 1)}…` : s);

function curate(f: Finding, all: Finding[], redact: Redact): ReportFinding {
  const index = (id: string) => all.findIndex((g) => g.id === id);
  const self = all.indexOf(f);
  return {
    id: f.id,
    title: redact(f.title),
    cause: redact(f.cause),
    remedy: f.remedy,
    ...(f.subject !== undefined ? { subject: redact(f.subject) } : {}),
    mods: f.mods ?? [],
    ...(f.cost.seconds !== undefined ? { seconds: f.cost.seconds, certainty: certaintyOf(f) } : {}),
    method: redact(f.cost.method),
    places: f.places ?? [],
    parts: partsOf(f),
    evidence: f.evidence.slice(0, EVIDENCE_LINES).map((e) => ({ source: e.source, ...(e.line !== undefined ? { line: e.line } : {}), text: clip(redact(e.text)) })),
    moreEvidence: Math.max(0, f.evidence.length - EVIDENCE_LINES),
    action: redact(f.action),
    notes: (f.notes ?? []).map(redact),
    informational: Boolean(f.informational),
    follows: (f.related ?? []).map(index).filter((i) => i >= 0 && i !== self),
    followers: all.flatMap((g, i) => (i !== self && (g.related ?? []).includes(f.id) ? [i] : [])),
  };
}

// ---------------------------------------------------------------- grouping

interface GroupKey {
  key: string;
  kind: ModGroup["kind"];
  name: string;
  folder?: string;
}

/** The group a finding goes in (rules in the plan): its mod, its mods together, its related finding's group, or its own. */
function groupOf(i: number, fs: ReportFinding[], seen = new Set<number>()): GroupKey {
  const f = fs[i];
  if (f.mods.length === 1) {
    const m = f.mods[0];
    return { key: m.name, kind: "mod", name: m.name, ...(m.folder && m.folder !== m.name ? { folder: m.folder } : {}) };
  }
  if (f.mods.length > 1) {
    const names = f.mods.map((m) => m.name).sort();
    const joiner = f.mods.some((m) => m.role === "candidate") ? " or " : " and ";
    return { key: `mods:${names.join("|")}${joiner.trim()}`, kind: "mods", name: names.join(joiner) };
  }
  seen.add(i);
  const to = f.follows.find((j) => !seen.has(j));
  if (to !== undefined) return groupOf(to, fs, seen);
  return { key: `install:${f.id}`, kind: "install", name: f.cause };
}

const total = (t: Totals) => t.measured + t.likely;

function add(t: Totals, seconds: number | undefined, certainty: Certainty | undefined): void {
  if (seconds === undefined) return;
  if (certainty === "measured") t.measured += seconds;
  else t.likely += seconds;
}

function rankedList<T>(list: T[], totals: (t: T) => Totals): Ranked<T> {
  const top = list.slice(0, TOP);
  const left = list.slice(TOP);
  if (!left.length) return { top };
  const rest = { count: left.length, measured: 0, likely: 0 };
  for (const x of left) {
    rest.measured += totals(x).measured;
    rest.likely += totals(x).likely;
  }
  return { top, rest };
}

function groups(fs: ReportFinding[], part: Part): Ranked<ModGroup> {
  const byKey = new Map<string, ModGroup & { numbered: boolean }>();
  fs.forEach((f, i) => {
    if (!f.parts.includes(part)) return;
    const k = groupOf(i, fs);
    const g = byKey.get(k.key) ?? { ...k, measured: 0, likely: 0, findings: [], numbered: false };
    const s = secondsIn(f, part);
    add(g, s, f.certainty);
    if (s !== undefined) g.numbered = true;
    g.findings.push(i);
    byKey.set(k.key, g);
  });
  const list = [...byKey.values()].sort((a, b) => Number(b.numbered) - Number(a.numbered) || total(b) - total(a));
  for (const g of list) g.findings.sort((a, b) => (secondsIn(fs[b], part) ?? -1) - (secondsIn(fs[a], part) ?? -1));
  return rankedList(
    list.map(({ numbered: _, ...g }) => g),
    (g) => g,
  );
}

// ---------------------------------------------------------------- points of attention

const actionable = (f: ReportFinding) => f.remedy === "fix" || f.remedy === "trade-off";

/** Decision 3: actionable first by cost; then the rest by impact (a likely cost weighs LIKELY_WEIGHT); filled up to MIN_POINTS with informational ones. */
function points(fs: ReportFinding[], part: Part): number[] {
  const inPart = fs.map((_, i) => i).filter((i) => fs[i].parts.includes(part));
  const cost = (i: number) => secondsIn(fs[i], part) ?? -1;
  const impact = (i: number) => {
    const s = secondsIn(fs[i], part);
    return s === undefined ? -1 : fs[i].certainty === "likely" ? s * LIKELY_WEIGHT : s;
  };
  // On a tie the measured finding goes first: it is at least half the guess.
  const byImpact = (a: number, b: number) => impact(b) - impact(a) || Number(fs[a].certainty === "likely") - Number(fs[b].certainty === "likely");
  const first = inPart.filter((i) => actionable(fs[i])).sort((a, b) => cost(b) - cost(a));
  const then = inPart.filter((i) => fs[i].remedy === "report").sort(byImpact);
  // A finding that follows from another point shows with it (its followers), not as a point of its own.
  const followsOne = (i: number, from: number[]) => fs[i].follows.some((j) => from.includes(j));
  const ranked = [...first, ...then];
  const list = ranked.filter((i) => !followsOne(i, ranked)).slice(0, MAX_POINTS);
  if (list.length < MIN_POINTS) {
    const fill = inPart.filter((i) => fs[i].remedy === "none" && !followsOne(i, ranked) && secondsIn(fs[i], part) !== undefined).sort(byImpact);
    list.push(...fill.slice(0, MIN_POINTS - list.length));
  }
  return list;
}

// ---------------------------------------------------------------- Holds

function holdRow(h: RunAnalysis["holds"][number], fs: ReportFinding[]): HoldRow {
  const costs: HoldCost[] = [];
  fs.forEach((f, i) => {
    if (!f.certainty) return;
    const s = f.places.filter((p) => p.where.phase === "hold" && p.where.hold === h.label).reduce((x, p) => x + p.seconds, 0);
    if (s > 0) costs.push({ finding: i, seconds: s, certainty: f.certainty });
  });
  costs.sort((a, b) => b.seconds - a.seconds);
  const t: Totals = { measured: 0, likely: 0 };
  for (const c of costs) add(t, c.seconds, c.certainty);
  return {
    label: h.label,
    name: holdName(h.label),
    seconds: h.seconds,
    source: h.source,
    costs: rankedList(costs, (c) => (c.certainty === "measured" ? { measured: c.seconds, likely: 0 } : { measured: 0, likely: c.seconds })),
    unmeasured: Math.max(0, h.seconds - t.measured),
    likely: t.likely,
  };
}

// ---------------------------------------------------------------- headline

function headlineTop(fs: ReportFinding[]): Report["headline"]["top"] {
  const combined = (i: number) => {
    const f = fs[i];
    const added = f.certainty === "measured" && f.followers.length > 0 && f.followers.every((j) => fs[j].certainty === "measured");
    return { added, seconds: f.seconds === undefined ? undefined : f.seconds + (added ? f.followers.reduce((s, j) => s + fs[j].seconds!, 0) : 0) };
  };
  const best = fs
    .map((_, i) => i)
    .filter((i) => actionable(fs[i]) && fs[i].follows.length === 0)
    .sort((a, b) => (combined(b).seconds ?? -1) - (combined(a).seconds ?? -1))[0];
  if (best === undefined) return undefined;
  const c = combined(best);
  return {
    finding: best,
    followers: fs[best].followers,
    ...(c.seconds !== undefined ? { seconds: c.seconds, certainty: fs[best].certainty } : {}),
    followersAdded: c.added,
  };
}

// ---------------------------------------------------------------- report

function countdownTime(a: RunAnalysis): { seconds: number; source: "profiler" | "log" } | undefined {
  const ready = a.countdown.metrics.find((m) => m.label === "Main menu ready (since process start)")?.seconds;
  if (a.profilerOn && ready !== undefined) return { seconds: ready, source: "profiler" };
  if (a.countdown.phases?.length) return { seconds: a.countdown.phases.reduce((s, p) => s + p.seconds, 0), source: "log" };
  return undefined;
}

function notices(a: RunAnalysis): Notice[] {
  const out: Notice[] = [];
  if (a.input.missing.length)
    out.push({ text: `This report is from ${LEVEL_NAME[a.input.level]}. ${a.input.level === "log" ? "The T-Minus profiler" : "The profiler's records file"} would add:`, items: a.input.missing });
  if (a.holds.some((h) => h.source === "ShowUI"))
    out.push({ text: "Without the profiler, only Holds into the Space Center and Flight are timed, from the scene request to KSP's ShowUI line." });
  return out;
}

export function buildReport(a: RunAnalysis): Report {
  const redact = redactor(a.identifying);
  const fs = a.findings.map((f) => curate(f, a.findings, redact));
  const cd = countdownTime(a);
  const stage = (p: { label: string; seconds: number; modCode: boolean }): Stage => ({ label: p.label, seconds: p.seconds, modCode: p.modCode });
  return {
    format: REPORT_FORMAT,
    run: {
      tminusVersion: a.version,
      level: a.input.level,
      levelName: LEVEL_NAME[a.input.level],
      profilerOn: a.profilerOn,
      ...(a.system ? { system: a.system } : {}),
      ...(a.install?.kspcf ? { kspcf: a.install.kspcf } : {}),
      ...(a.install?.assemblyCount !== undefined ? { assemblyCount: a.install.assemblyCount } : {}),
    },
    notices: notices(a),
    headline: { ...(cd ? { countdown: cd } : {}), top: headlineTop(fs) },
    countdown: {
      ...(cd ?? {}),
      points: points(fs, "countdown"),
      groups: groups(fs, "countdown"),
      stages: (a.countdown.phases ?? []).map(stage),
      ...(a.countdown.moduleManager ? { moduleManager: a.countdown.moduleManager } : {}),
    },
    holds: {
      points: points(fs, "holds"),
      groups: groups(fs, "holds"),
      rows: a.holds.map((h) => holdRow(h, fs)),
      flightEntries: a.flightEntries.map((e) => ({ label: e.label, name: holdName(e.label), stages: e.phases.map(stage) })),
    },
    findings: fs,
  };
}

// ---------------------------------------------------------------- invariants

/** What must hold for every report; returns the broken ones. Tests and check-archived run it. */
export function checkReport(r: Report, a: RunAnalysis): string[] {
  const out: string[] = [];
  if (r.findings.length !== a.findings.length) out.push(`${r.findings.length} findings in the report, ${a.findings.length} in the analysis`);
  for (const part of ["countdown", "holds"] as Part[]) {
    const g = r[part].groups;
    const listed = [...g.top.flatMap((x) => x.findings)];
    const inPart = r.findings.flatMap((f, i) => (f.parts.includes(part) ? [i] : []));
    if (!g.rest) {
      const missing = inPart.filter((i) => !listed.includes(i));
      if (missing.length) out.push(`${part}: findings ${missing.join(", ")} in no group`);
    }
    if (new Set(listed).size !== listed.length) out.push(`${part}: a finding in more than one group`);
    const sum = (key: keyof Totals) => g.top.reduce((s, x) => s + x[key], 0) + (g.rest?.[key] ?? 0);
    const expect: Totals = { measured: 0, likely: 0 };
    for (const i of inPart) add(expect, secondsIn(r.findings[i], part), r.findings[i].certainty);
    for (const key of ["measured", "likely"] as const)
      if (Math.abs(sum(key) - expect[key]) > 1e-6) out.push(`${part}: groups add up to ${sum(key)} ${key} s, findings to ${expect[key]}`);
    const p = r[part].points;
    if (p.length > MAX_POINTS) out.push(`${part}: ${p.length} points`);
    if (p.some((i) => !inPart.includes(i))) out.push(`${part}: a point outside the part`);
  }
  for (const h of r.holds.rows) if (h.unmeasured < 0 || h.unmeasured > h.seconds + 1e-9) out.push(`Hold ${h.label}: unmeasured ${h.unmeasured} s of ${h.seconds}`);
  for (const f of r.findings)
    if (f.evidence.length > EVIDENCE_LINES || f.evidence.some((e) => e.text.length > EVIDENCE_CHARS)) out.push(`${f.id}: evidence over the limits`);
  // Redaction: no root and no identifier survives anywhere in the model.
  const text = JSON.stringify(r);
  for (const root of a.identifying.roots) if (text.includes(JSON.stringify(root).slice(1, -1))) out.push(`an install root survives redaction`);
  const leftover = redactor(a.identifying);
  const strings: string[] = [];
  JSON.parse(text, (_k, v) => (typeof v === "string" && strings.push(v), v));
  if (strings.some((s) => leftover(s) !== s)) out.push("a string survives redaction");
  return out;
}
