// Expectations for archived runs: what check-archived verifies on each run.
//
// They describe one person's installs, so they live outside the repo, next to
// the run archive. test-fixtures/expectations.example.json shows every key.
// The file is validated strictly before any run is checked: an unknown key, a
// wrong type or an invalid regex is an error, never ignored.

import type { Finding, InputLevel, Where } from "../core/findings/index.js";
import type { PartDatabaseState } from "../core/model.js";

export const FORMAT = 1;

const LEVELS: InputLevel[] = ["log", "log+summary", "log+profiler"];
const PHASES: Where["phase"][] = ["countdown", "hold", "session"];
const PART_DATABASE: PartDatabaseState[] = ["loaded", "created", "version-changed"];

export interface Expectations {
  format: number;
  suites: Suite[];
}

export interface Suite {
  name: string;
  /** Folder with one subfolder per run, relative to the expectations file. */
  runs: string;
  expect: Expectation[];
}

/** One check. Exactly one of finding, absent and count. */
export interface Expectation {
  name: string;
  /** The check applies only to runs that meet every condition given. */
  when?: { level?: InputLevel[]; startTimed?: boolean; hold?: RegExp; partDatabase?: PartDatabaseState[]; mod?: string[]; summaryFormat?: number };
  /** Some finding matches. */
  finding?: Matcher;
  /** No finding matches. */
  absent?: Matcher;
  /** The run has exactly this many findings. */
  count?: number;
}

/** Every field given must match. Regexes are searched, not anchored. */
export interface Matcher {
  id: string[];
  subject?: string;
  title?: RegExp;
  /** Some evidence line matches. */
  evidence?: RegExp;
  phase?: Where["phase"];
  /** Some place of the cost matches (the finding's where, when it has no places). */
  place?: { phase?: Where["phase"]; hold?: RegExp };
  minSeconds?: number;
  informational?: boolean;
}

/** What check-archived knows about a run when it checks it. */
export interface RunFacts {
  level: InputLevel;
  /** The profiler timed addon Start (addonStartHooks). */
  startTimed: boolean;
  /** Hold labels, e.g. "EDITOR->FLIGHT". */
  holds: string[];
  /** How PartLoader got its database, from KSP.log. */
  partDatabase?: PartDatabaseState;
  /** GameData folders of the installed mods. */
  modFolders: string[];
  /** The format of the profiler's summary in KSP.log, when it has one. */
  summaryFormat?: number;
  findings: Finding[];
}

class Invalid extends Error {}

type Obj = Record<string, unknown>;

function object(v: unknown, at: string, keys: string[]): Obj {
  if (typeof v !== "object" || v === null || Array.isArray(v)) throw new Invalid(`${at}: expected an object`);
  const unknown = Object.keys(v).filter((k) => !keys.includes(k));
  if (unknown.length) throw new Invalid(`${at}: unknown key${unknown.length > 1 ? "s" : ""} ${unknown.join(", ")}`);
  return v as Obj;
}

function string(v: unknown, at: string): string {
  if (typeof v !== "string" || !v) throw new Invalid(`${at}: expected a non-empty string`);
  return v;
}

function regex(v: unknown, at: string): RegExp {
  try {
    return new RegExp(string(v, at));
  } catch (e) {
    if (e instanceof Invalid) throw e;
    throw new Invalid(`${at}: invalid regex (${(e as Error).message})`);
  }
}

function oneOf<T extends string>(v: unknown, at: string, values: T[]): T {
  if (!values.includes(v as T)) throw new Invalid(`${at}: expected one of ${values.join(", ")}`);
  return v as T;
}

function strings(v: unknown, at: string): string[] {
  const list = Array.isArray(v) ? v : [v];
  if (!list.length) throw new Invalid(`${at}: expected a string or a non-empty list`);
  return list.map((s, i) => string(s, Array.isArray(v) ? `${at}[${i}]` : at));
}

function boolean(v: unknown, at: string): boolean {
  if (typeof v !== "boolean") throw new Invalid(`${at}: expected true or false`);
  return v;
}

function number(v: unknown, at: string): number {
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0) throw new Invalid(`${at}: expected a number ≥ 0`);
  return v;
}

const optional = <T>(v: unknown, read: (v: unknown) => T): T | undefined => (v === undefined ? undefined : read(v));

function matcher(v: unknown, at: string): Matcher {
  const o = object(v, at, ["id", "subject", "title", "evidence", "phase", "place", "minSeconds", "informational"]);
  const place = optional(o.place, (p) => {
    const q = object(p, `${at}.place`, ["phase", "hold"]);
    return { phase: optional(q.phase, (x) => oneOf(x, `${at}.place.phase`, PHASES)), hold: optional(q.hold, (x) => regex(x, `${at}.place.hold`)) };
  });
  return {
    id: strings(o.id, `${at}.id`),
    subject: optional(o.subject, (x) => string(x, `${at}.subject`)),
    title: optional(o.title, (x) => regex(x, `${at}.title`)),
    evidence: optional(o.evidence, (x) => regex(x, `${at}.evidence`)),
    phase: optional(o.phase, (x) => oneOf(x, `${at}.phase`, PHASES)),
    place,
    minSeconds: optional(o.minSeconds, (x) => number(x, `${at}.minSeconds`)),
    informational: optional(o.informational, (x) => boolean(x, `${at}.informational`)),
  };
}

function expectation(v: unknown, at: string): Expectation {
  const o = object(v, at, ["name", "when", "finding", "absent", "count"]);
  const kinds = (["finding", "absent", "count"] as const).filter((k) => o[k] !== undefined);
  if (kinds.length !== 1) throw new Invalid(`${at}: expected exactly one of finding, absent, count`);
  const when = optional(o.when, (w) => {
    const q = object(w, `${at}.when`, ["level", "startTimed", "hold", "partDatabase", "mod", "summaryFormat"]);
    return {
      level: optional(q.level, (x) => strings(x, `${at}.when.level`).map((l, i) => oneOf(l, `${at}.when.level[${i}]`, LEVELS))),
      startTimed: optional(q.startTimed, (x) => boolean(x, `${at}.when.startTimed`)),
      hold: optional(q.hold, (x) => regex(x, `${at}.when.hold`)),
      partDatabase: optional(q.partDatabase, (x) =>
        strings(x, `${at}.when.partDatabase`).map((d, i) => oneOf(d, `${at}.when.partDatabase[${i}]`, PART_DATABASE)),
      ),
      // "Folder": that GameData folder has a loaded assembly; "!Folder": it has none.
      mod: optional(q.mod, (x) => strings(x, `${at}.when.mod`)),
      // At least this summary format: checks on data older profilers did not record.
      summaryFormat: optional(q.summaryFormat, (x) => number(x, `${at}.when.summaryFormat`)),
    };
  });
  return {
    name: string(o.name, `${at}.name`),
    when,
    finding: optional(o.finding, (x) => matcher(x, `${at}.finding`)),
    absent: optional(o.absent, (x) => matcher(x, `${at}.absent`)),
    count: optional(o.count, (x) => {
      if (!Number.isInteger(number(x, `${at}.count`))) throw new Invalid(`${at}.count: expected a whole number`);
      return x as number;
    }),
  };
}

/** Parses and validates an expectations file; throws an Error naming the first problem. */
export function parseExpectations(text: string): Expectations {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (e) {
    throw new Error(`expectations: not valid JSON (${(e as Error).message})`);
  }
  try {
    const o = object(json, "expectations", ["format", "suites"]);
    if (o.format !== FORMAT) throw new Invalid(`expectations.format: expected ${FORMAT}`);
    if (!Array.isArray(o.suites) || !o.suites.length) throw new Invalid("expectations.suites: expected a non-empty list");
    const suites = o.suites.map((s, i) => {
      const at = `suites[${i}]`;
      const q = object(s, at, ["name", "runs", "expect"]);
      if (!Array.isArray(q.expect) || !q.expect.length) throw new Invalid(`${at}.expect: expected a non-empty list`);
      return { name: string(q.name, `${at}.name`), runs: string(q.runs, `${at}.runs`), expect: q.expect.map((e, j) => expectation(e, `${at}.expect[${j}]`)) };
    });
    return { format: FORMAT, suites };
  } catch (e) {
    if (e instanceof Invalid) throw new Error(`expectations: ${e.message}`);
    throw e;
  }
}

function matches(m: Matcher, f: Finding): boolean {
  const places = f.places ?? [{ where: f.where, seconds: f.cost.seconds ?? 0 }];
  return (
    m.id.includes(f.id) &&
    (m.subject === undefined || f.subject === m.subject) &&
    (m.title === undefined || m.title.test(f.title)) &&
    (m.evidence === undefined || f.evidence.some((e) => m.evidence!.test(e.text))) &&
    (m.phase === undefined || f.where.phase === m.phase) &&
    (m.place === undefined || places.some((p) => (m.place!.phase === undefined || p.where.phase === m.place!.phase) && (m.place!.hold === undefined || m.place!.hold.test(p.where.hold ?? "")))) &&
    (m.minSeconds === undefined || (f.cost.seconds ?? 0) >= m.minSeconds) &&
    (m.informational === undefined || Boolean(f.informational) === m.informational)
  );
}

export function applies(e: Expectation, run: RunFacts): boolean {
  const w = e.when;
  if (!w) return true;
  return (
    (w.level === undefined || w.level.includes(run.level)) &&
    (w.startTimed === undefined || w.startTimed === run.startTimed) &&
    (w.hold === undefined || run.holds.some((h) => w.hold!.test(h))) &&
    (w.partDatabase === undefined || (run.partDatabase !== undefined && w.partDatabase.includes(run.partDatabase))) &&
    (w.mod === undefined || w.mod.every((m) => (m.startsWith("!") ? !run.modFolders.includes(m.slice(1)) : run.modFolders.includes(m)))) &&
    (w.summaryFormat === undefined || (run.summaryFormat ?? 0) >= w.summaryFormat)
  );
}

/** The names of the expectations that apply to the run and fail on it. */
export function failures(suite: Suite, run: RunFacts): string[] {
  return suite.expect
    .filter((e) => applies(e, run))
    .filter((e) => {
      if (e.finding) return !run.findings.some((f) => matches(e.finding!, f));
      if (e.absent) return run.findings.some((f) => matches(e.absent!, f));
      return run.findings.length !== e.count;
    })
    .map((e) => e.name);
}
