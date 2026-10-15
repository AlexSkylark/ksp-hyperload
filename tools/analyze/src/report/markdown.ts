// Markdown report: formats the model. No analysis here, only presentation
// (rounding, top-N cuts, wording).

import type { Comparison, LongFrame, RunAnalysis } from "../core/model.js";
import type { Finding } from "../core/findings/index.js";

/** Rows shown per ranked table. */
const TOP = 8;
/** Evidence lines shown per finding. */
const EVIDENCE = 6;

const fmt = (n: number | undefined, digits = 2) => (n === undefined ? "—" : n.toFixed(digits));
const cell = (s: string) => s.replace(/\|/g, "\\|");

function reportCost(f: Finding): string {
  const c = f.cost;
  if (c.kind === "not-measured") return `not measured on this install (${c.method})`;
  return `${fmt(c.seconds, 1)} s, ${c.kind} (${c.method})`;
}

function reportFinding(f: Finding, i: number): string[] {
  const where = f.where.phase === "hold" ? `Hold ${f.where.hold}` : f.where.phase === "countdown" ? "Countdown" : "whole session";
  const out = [`#### ${i + 1}. ${f.title}`, ""];
  out.push(`- **Cost:** ${reportCost(f)}`);
  out.push(`- **Where:** ${where}`);
  out.push(`- **Confidence:** ${f.confidence}`);
  out.push(`- **Action:** ${f.action}`);
  for (const n of f.notes ?? []) out.push(`- ${n}`);
  out.push("", "Evidence:", "", "```text");
  for (const e of f.evidence.slice(0, EVIDENCE)) out.push(e.line !== undefined ? `KSP.log:${e.line}  ${e.text}` : `profiler  ${e.text}`);
  if (f.evidence.length > EVIDENCE) out.push(`(${f.evidence.length - EVIDENCE} more)`);
  out.push("```", "");
  return out;
}

function reportFrames(frames: LongFrame[]): string[] {
  const out: string[] = [];
  for (const f of frames) {
    out.push(`**${f.label}: ${fmt(f.seconds, 1)} s frame**`, "");
    if (!f.around.length) {
      out.push("(no gap ≥ 0.5 s)", "");
      continue;
    }
    out.push(`Gaps ≥ 0.5 s cover ${fmt(f.gapSeconds, 1)} s of the frame.`, "");
    out.push("| Around | gaps | s |", "|---|---|---|");
    for (const g of f.around.slice(0, TOP)) out.push(`| ${cell(g.source)} | ${g.gaps} | ${fmt(g.seconds, 1)} |`);
    out.push("");
  }
  return out;
}

const GAP_NOTE = "A gap is time between two log lines: the work happened after the first line and before the second.";

export function reportRun(a: RunAnalysis): string[] {
  const out: string[] = [];
  out.push(`## ${a.name}`, "");
  out.push(`- T-Minus: \`${a.version}\`, profiler ${a.profilerOn ? "on" : "off"}`);
  if (a.install) out.push(`- KSPCF ${a.install.kspcf ?? "absent"}, texture cache ${a.install.kspcfTextureCache}, ${a.install.assemblyCount} assemblies, uptime at start ${a.install.uptimeAtStartHours.toFixed(1)} h`);
  if (a.conditions) out.push(`- MM cache: ${a.conditions.mmCache}, PartDatabase rebuilt: ${a.conditions.partDatabaseRebuilt}`);
  out.push(`- Input: ${a.input.level === "log" ? "KSP.log only" : "KSP.log and the profiler's .jsonl"}. One run.`);
  if (a.input.missing.length) {
    out.push("- The T-Minus profiler's .jsonl would add:");
    for (const m of a.input.missing) out.push(`  - ${m}`);
  }
  out.push("");

  out.push("### Findings", "");
  if (!a.findings.length) out.push("No findings.", "");
  a.findings.forEach((f, i) => out.push(...reportFinding(f, i)));

  out.push("### Countdown", "");
  out.push("| Countdown | s |", "|---|---|");
  for (const m of a.countdown.metrics) out.push(`| ${m.label} | ${fmt(m.seconds, 1)} |`);
  if (a.countdown.mainMenu) out.push(`| Main menu scene, request to ready (${a.countdown.mainMenu.label}) | ${fmt(a.countdown.mainMenu.seconds)} |`);
  out.push("");

  if (a.countdown.loaders.length) {
    out.push("| Loader | s |", "|---|---|");
    for (const l of a.countdown.loaders) out.push(`| ${cell(l.name)}${l.approx ? " ~" : ""} | ${fmt(l.seconds)} |`);
    out.push("");
  }

  const frames = a.longFrames ?? [];
  const countdownFrames = frames.filter((f) => f.phase === "countdown");
  if (countdownFrames.length) out.push("**Long frames (≥ 2 s) in the Countdown**", "", GAP_NOTE, "", ...reportFrames(countdownFrames));

  out.push("### Holds", "");
  if (!a.holds.length) out.push("No Hold detected.", "");
  else {
    out.push("| Hold | s | source |", "|---|---|---|");
    for (const h of a.holds) out.push(`| ${h.label} | ${fmt(h.seconds)} | ${h.source} |`);
    out.push("");
  }
  const holdLabels = [...new Set(frames.filter((f) => f.phase === "hold").map((f) => f.hold!))];
  if (holdLabels.length) out.push(GAP_NOTE, "");
  for (const label of holdLabels) {
    out.push(`#### Hold ${label}: long frames (≥ 2 s)`, "");
    out.push(...reportFrames(frames.filter((f) => f.phase === "hold" && f.hold === label)));
  }
  const between = frames.filter((f) => f.phase === "between");
  if (between.length) out.push("#### Long frames (≥ 2 s) between Holds", "", ...reportFrames(between));

  if (a.aggregates.length || a.slowEvents.length) out.push("### Profiler totals", "");

  // Largest aggregate entries per family.
  for (const { family, entries } of a.aggregates) {
    const top = entries.slice(0, TOP);
    out.push(`**${family}** (whole session, top ${top.length})`, "");
    out.push("| Key | ms |", "|---|---|");
    for (const e of top) out.push(`| ${cell(e.key)} | ${fmt(e.ms, 0)} |`);
    out.push("");
  }

  const slowEvents = a.slowEvents.slice(0, TOP);
  if (slowEvents.length) {
    out.push("**Slowest single GameEvent dispatches**", "", "| Event | ms |", "|---|---|");
    for (const e of slowEvents) out.push(`| ${cell(e.event)} | ${fmt(e.ms, 0)} |`);
    out.push("");
  }
  return out;
}

export function reportComparison(c: Comparison): string[] {
  const out: string[] = ["## Comparison", ""];
  out.push(`| Metric | ${c.groups.map((g) => `profiler ${g}: mean (min–max, n)`).join(" | ")} |`);
  out.push(`|---|${c.groups.map(() => "---").join("|")}|`);
  for (const { metric, byGroup } of c.rows) {
    const cells = c.groups.map((g) => {
      const s = byGroup.get(g);
      if (!s) return "—";
      return `${fmt(s.mean)} (${fmt(s.min)}–${fmt(s.max)}, ${s.n})`;
    });
    out.push(`| ${metric} | ${cells.join(" | ")} |`);
  }
  out.push("", "Holds into SPACECENTER/FLIGHT use KSP's ShowUI line in every run, so on/off are comparable.");
  return out;
}

/** The whole report: each run, then a comparison when there are several. */
export function renderReport(analyses: RunAnalysis[], comparison?: Comparison): string {
  const lines: string[] = ["# T-Minus report", ""];
  for (const a of analyses) lines.push(...reportRun(a));
  if (comparison) lines.push(...reportComparison(comparison));
  return lines.join("\n");
}
