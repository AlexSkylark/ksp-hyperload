// T-Minus profiler analysis.
//
// Usage: node tools/analyze/analyze.mts <run dir> [<run dir> ...]
//
// A run dir holds a KSP.log and, when the profiler was on, the run's .jsonl
// (Prepare-BenchRun.ps1 archives both to D:\KSP\bench-runs\<time>\).
// Prints a Markdown report: per run, then a comparison when several runs are
// given. Node 24+ runs this TypeScript file directly (type stripping): no
// build, no dependencies.

import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, basename } from "node:path";

// ---------------------------------------------------------------- types

interface LogLine {
  /** Seconds since midnight of the run's first day (rolls past 86400 after midnight). */
  t: number;
  level: string;
  text: string;
}

interface Run {
  name: string;
  log: LogLine[];
  /** Records from the profiler .jsonl; empty when the profiler was off. */
  records: Record<string, any>[];
  profilerOn: boolean;
  version: string;
  /** KSP.log time (s) of profiler time 0 (process start), when known. */
  processStartLogT?: number;
}

interface Transition {
  label: string;
  seconds: number;
  /** How "ready" was determined. */
  source: "profiler" | "ShowUI";
}

// ---------------------------------------------------------------- loading

const LOG_LINE = /^\[(LOG|WRN|ERR|EXC) (\d\d):(\d\d):(\d\d\.\d+)\] ?(.*)$/;

function parseLog(path: string): LogLine[] {
  const lines: LogLine[] = [];
  let dayOffset = 0;
  let last = 0;
  for (const raw of readFileSync(path, "utf8").split(/\r?\n/)) {
    const m = LOG_LINE.exec(raw);
    if (!m) continue;
    let t = Number(m[2]) * 3600 + Number(m[3]) * 60 + Number(m[4]) + dayOffset;
    if (t < last - 3600) {
      // Clock went backwards by a lot: the run crossed midnight.
      dayOffset += 86400;
      t += 86400;
    }
    last = t;
    lines.push({ t, level: m[1], text: m[5] });
  }
  return lines;
}

function loadRun(dir: string): Run {
  const logPath = join(dir, "KSP.log");
  if (!existsSync(logPath)) throw new Error(`no KSP.log in ${dir}`);
  const log = parseLog(logPath);

  const jsonl = readdirSync(dir).filter((f) => f.endsWith(".jsonl")).sort().pop();
  const records = jsonl
    ? readFileSync(join(dir, jsonl), "utf8").split(/\r?\n/).filter((l) => l.trim()).map((l) => JSON.parse(l))
    : [];

  // Runs before 2026-10-15 were made under the project's old name, HyperLoad:
  // "[HyperLoad] HyperLoad <version> loaded". Accept both tags.
  const loaded = log.find((l) => /^\[(TMinus|HyperLoad)\] (T-Minus|HyperLoad) \S+ loaded/.test(l.text));
  const version = loaded?.text.match(/(?:T-Minus|HyperLoad) (\S+) loaded/)?.[1] ?? "not installed";
  const profilerOn =
    records.length > 0 && !log.some((l) => /^\[(TMinus|HyperLoad)\] Profiler: disabled/.test(l.text));

  // Anchor profiler time to log time: the "loaded" line is written right when
  // the profiler starts (profilerStartMs after process start).
  const header = records.find((r) => r.kind === "run");
  const processStartLogT = loaded && header ? loaded.t - header.profilerStartMs / 1000 : undefined;

  return { name: basename(dir), log, records, profilerOn, version, processStartLogT };
}

// ---------------------------------------------------------------- metrics

function logNumber(run: Run, pattern: RegExp): number | undefined {
  for (const l of run.log) {
    const m = pattern.exec(l.text);
    if (m) return Number(m[1]);
  }
  return undefined;
}

function startupMetrics(run: Run): Record<string, number | undefined> {
  const first = run.log[0]?.t ?? 0;
  const menuSwitch = run.log.find((l) => l.text.includes("Scene Change : From LOADING to MAINMENU"));
  const ready = run.records.find((r) => r.kind === "span" && r.name === "scene.transition" && r.detail === "LOADING->MAINMENU");
  return {
    "Loading Systems (KSP)": logNumber(run, /Loading Systems: Elapsed time is ([\d.]+)s/),
    "MM Total loading Time": logNumber(run, /\[ModuleManager\] Total loading Time = ([\d.]+)s/),
    "Main menu scene switch (since log start)": menuSwitch ? menuSwitch.t - first : undefined,
    "Main menu ready (since process start)": ready ? (ready.t + ready.dur) / 1000 : undefined,
  };
}

/**
 * Transitions from the profiler, or from KSP's ShowUI line when it was off
 * (or when forced, to compare profiler-on runs with profiler-off runs).
 */
function transitions(run: Run, source: "auto" | "ShowUI" = "auto"): Transition[] {
  if (run.profilerOn && source === "auto") {
    return run.records
      .filter((r) => r.kind === "span" && r.name === "scene.transition")
      .map((r) => ({ label: r.detail, seconds: r.dur / 1000, source: "profiler" as const }));
  }
  // [C] LoadingBufferMask.Hide calls UIMasterController.ShowUI, which logs
  // "[UIMasterController]: ShowUI": same millisecond as the profiler's marker
  // for SPACECENTER and FLIGHT. Other scenes log ShowUI too early to use.
  const result: Transition[] = [];
  let pending: { label: string; t: number } | undefined;
  for (const l of run.log) {
    const m = /Scene Change : From (\w+) to (\w+)/.exec(l.text);
    if (m) {
      pending = m[2] === "SPACECENTER" || m[2] === "FLIGHT" ? { label: `${m[1]}->${m[2]}`, t: l.t } : undefined;
    } else if (pending && l.text.includes("[UIMasterController]: ShowUI")) {
      result.push({ label: pending.label, seconds: l.t - pending.t, source: "ShowUI" });
      pending = undefined;
    }
  }
  return result;
}

// ---------------------------------------------------------------- log gaps

/** Best guess of who wrote a log line: a [Tag], a "date,Mod," prefix, or a "Name:" prefix. */
function sourceOf(text: string): string {
  let m = /^\[([^\]]{2,60})\]/.exec(text);
  if (m) return m[1].replace(/:.*/, "");
  m = /^\d+\/\d+\/\d+ [\d:]+ [AP]M,([^,]+),/.exec(text);
  if (m) return m[1];
  m = /^([A-Za-z][\w.-]{2,40})(\(|:)/.exec(text);
  if (m) return m[1];
  return text.slice(0, 40);
}

interface Gap {
  seconds: number;
  before: LogLine;
  after: LogLine;
}

/** Silent stretches of at least minSeconds between log lines in [from, to]. */
function gaps(run: Run, from: number, to: number, minSeconds: number): Gap[] {
  const result: Gap[] = [];
  let prev: LogLine | undefined;
  for (const l of run.log) {
    if (l.t < from) continue;
    if (l.t > to) break;
    if (prev && l.t - prev.t >= minSeconds) result.push({ seconds: l.t - prev.t, before: prev, after: l });
    prev = l;
  }
  return result;
}

// ---------------------------------------------------------------- report

const fmt = (n: number | undefined, digits = 2) => (n === undefined ? "—" : n.toFixed(digits));
const cell = (s: string) => s.replace(/\|/g, "\\|");

function reportRun(run: Run): string[] {
  const out: string[] = [];
  const header = run.records.find((r) => r.kind === "run");
  const conditions = run.records.find((r) => r.kind === "conditions");
  out.push(`## ${run.name}`, "");
  out.push(`- T-Minus: \`${run.version}\`, profiler ${run.profilerOn ? "on" : "off"}`);
  if (header) out.push(`- KSPCF ${header.kspcf ?? "absent"}, texture cache ${header.kspcfTextureCache}, ${header.assemblyCount} assemblies, uptime at start ${(header.uptimeAtProcessStartMs / 3600000).toFixed(1)} h`);
  if (conditions) out.push(`- MM cache: ${conditions.mmCache}, PartDatabase rebuilt: ${conditions.partDatabaseRebuilt}`);
  out.push("");

  out.push("| Startup | s |", "|---|---|");
  for (const [k, v] of Object.entries(startupMetrics(run))) out.push(`| ${k} | ${fmt(v, 1)} |`);
  out.push("");

  const loaders = run.records.filter((r) => r.kind === "span" && r.name === "loader");
  if (loaders.length) {
    out.push("| Loader | s |", "|---|---|");
    for (const r of loaders) out.push(`| ${cell(r.detail)}${r.approx ? " ~" : ""} | ${fmt(r.dur / 1000)} |`);
    out.push("");
  }

  const ts = transitions(run);
  if (ts.length) {
    out.push("| Transition | s | source |", "|---|---|---|");
    for (const t of ts) out.push(`| ${t.label} | ${fmt(t.seconds)} | ${t.source} |`);
    out.push("");
  }

  // Long frames, each with the silent stretches of the log inside it.
  const frames = run.records.filter((r) => r.kind === "span" && r.name === "frame.long" && r.dur >= 2000);
  if (frames.length && run.processStartLogT !== undefined) {
    out.push("### Long frames (≥ 2 s) and log gaps inside them", "");
    out.push("A gap is time between two log lines: the work happened after the first line and before the second.", "");
    for (const f of frames) {
      const from = run.processStartLogT + f.t / 1000;
      const to = from + f.dur / 1000;
      out.push(`**${f.detail}: ${fmt(f.dur / 1000, 1)} s frame**`, "");
      const g = gaps(run, from, to, 0.5).sort((a, b) => b.seconds - a.seconds);
      const covered = g.reduce((s, x) => s + x.seconds, 0);
      if (!g.length) {
        out.push("(no gap ≥ 0.5 s)", "");
        continue;
      }
      // Group by the pair of sources around each gap.
      const bySource = new Map<string, { seconds: number; count: number }>();
      for (const x of g) {
        const a = sourceOf(x.before.text), b = sourceOf(x.after.text);
        const key = a === b ? a : `${a} → ${b}`;
        const e = bySource.get(key) ?? { seconds: 0, count: 0 };
        e.seconds += x.seconds;
        e.count++;
        bySource.set(key, e);
      }
      out.push(`Gaps ≥ 0.5 s cover ${fmt(covered, 1)} s of the frame.`, "");
      out.push("| Around | gaps | s |", "|---|---|---|");
      for (const [k, v] of [...bySource].sort((a, b) => b[1].seconds - a[1].seconds).slice(0, 8))
        out.push(`| ${cell(k)} | ${v.count} | ${fmt(v.seconds, 1)} |`);
      out.push("");
    }
  }

  // Largest aggregate entries per family.
  const families = ["addon.awake", "addon.start", "gameEvent.fire", "scenario.load", "part.parse.byMod", "partLoader.methods", "configNode.load"];
  for (const family of families) {
    const totals = new Map<string, number>();
    for (const r of run.records.filter((r) => r.kind === "aggregate" && r.name === family && !String(r.detail).startsWith("(other")))
      totals.set(r.detail, (totals.get(r.detail) ?? 0) + r.total);
    if (!totals.size) continue;
    const top = [...totals].sort((a, b) => b[1] - a[1]).slice(0, 8);
    out.push(`**${family}** (whole session, top ${top.length})`, "");
    out.push("| Key | ms |", "|---|---|");
    for (const [k, v] of top) out.push(`| ${cell(k)} | ${fmt(v, 0)} |`);
    out.push("");
  }

  const slowEvents = run.records.filter((r) => r.kind === "span" && r.name === "gameEvent.slow").sort((a, b) => b.dur - a.dur).slice(0, 8);
  if (slowEvents.length) {
    out.push("**Slowest single GameEvent dispatches**", "", "| Event | ms |", "|---|---|");
    for (const r of slowEvents) out.push(`| ${cell(r.detail)} | ${fmt(r.dur, 0)} |`);
    out.push("");
  }
  return out;
}

function stats(values: number[]) {
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  return { mean, min: Math.min(...values), max: Math.max(...values), n: values.length };
}

function reportComparison(runs: Run[]): string[] {
  const out: string[] = ["## Comparison", ""];
  const groups = new Map<string, Run[]>();
  for (const r of runs) {
    const key = r.profilerOn ? "on" : "off";
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }

  const rows = new Map<string, Map<string, number[]>>(); // metric -> group -> values
  const add = (metric: string, group: string, v: number | undefined) => {
    if (v === undefined) return;
    const m = rows.get(metric) ?? new Map<string, number[]>();
    m.set(group, [...(m.get(group) ?? []), v]);
    rows.set(metric, m);
  };
  for (const [group, rs] of groups)
    for (const r of rs) {
      for (const [k, v] of Object.entries(startupMetrics(r))) add(k, group, v);
      // ShowUI exists with the profiler on and off, so these compare fairly.
      for (const t of transitions(r, "ShowUI")) add(t.label, group, t.seconds);
    }

  const names = [...groups.keys()];
  out.push(`| Metric | ${names.map((g) => `profiler ${g}: mean (min–max, n)`).join(" | ")} |`);
  out.push(`|---|${names.map(() => "---").join("|")}|`);
  for (const [metric, byGroup] of rows) {
    const cells = names.map((g) => {
      const v = byGroup.get(g);
      if (!v?.length) return "—";
      const s = stats(v);
      return `${fmt(s.mean)} (${fmt(s.min)}–${fmt(s.max)}, ${s.n})`;
    });
    out.push(`| ${metric} | ${cells.join(" | ")} |`);
  }
  out.push("", "Transitions into SPACECENTER/FLIGHT use KSP's ShowUI line in every run, so on/off are comparable.");
  return out;
}

// ---------------------------------------------------------------- main

const dirs = process.argv.slice(2);
if (!dirs.length) {
  console.error("Usage: node tools/analyze/analyze.mts <run dir> [<run dir> ...]");
  process.exit(1);
}
const runs = dirs.map(loadRun);
const lines: string[] = ["# T-Minus profiler report", ""];
for (const run of runs) lines.push(...reportRun(run));
if (runs.length > 1) lines.push(...reportComparison(runs));
console.log(lines.join("\n"));
