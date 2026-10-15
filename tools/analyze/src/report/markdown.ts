// Markdown report: formats the model. No analysis here, only presentation
// (rounding, top-N cuts, wording).

import type { Comparison, RunAnalysis } from "../core/model.js";

/** Rows shown per ranked table. */
const TOP = 8;

const fmt = (n: number | undefined, digits = 2) => (n === undefined ? "—" : n.toFixed(digits));
const cell = (s: string) => s.replace(/\|/g, "\\|");

export function reportRun(a: RunAnalysis): string[] {
  const out: string[] = [];
  out.push(`## ${a.name}`, "");
  out.push(`- T-Minus: \`${a.version}\`, profiler ${a.profilerOn ? "on" : "off"}`);
  if (a.install) out.push(`- KSPCF ${a.install.kspcf ?? "absent"}, texture cache ${a.install.kspcfTextureCache}, ${a.install.assemblyCount} assemblies, uptime at start ${a.install.uptimeAtStartHours.toFixed(1)} h`);
  if (a.conditions) out.push(`- MM cache: ${a.conditions.mmCache}, PartDatabase rebuilt: ${a.conditions.partDatabaseRebuilt}`);
  out.push("");

  out.push("| Startup | s |", "|---|---|");
  for (const m of a.countdown.metrics) out.push(`| ${m.label} | ${fmt(m.seconds, 1)} |`);
  out.push("");

  if (a.countdown.loaders.length) {
    out.push("| Loader | s |", "|---|---|");
    for (const l of a.countdown.loaders) out.push(`| ${cell(l.name)}${l.approx ? " ~" : ""} | ${fmt(l.seconds)} |`);
    out.push("");
  }

  if (a.holds.length) {
    out.push("| Transition | s | source |", "|---|---|---|");
    for (const h of a.holds) out.push(`| ${h.label} | ${fmt(h.seconds)} | ${h.source} |`);
    out.push("");
  }

  // Long frames, each with the silent stretches of the log inside it.
  if (a.longFrames?.length) {
    out.push("### Long frames (≥ 2 s) and log gaps inside them", "");
    out.push("A gap is time between two log lines: the work happened after the first line and before the second.", "");
    for (const f of a.longFrames) {
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
  }

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
  out.push("", "Transitions into SPACECENTER/FLIGHT use KSP's ShowUI line in every run, so on/off are comparable.");
  return out;
}

/** The whole report: each run, then a comparison when there are several. */
export function renderReport(analyses: RunAnalysis[], comparison?: Comparison): string {
  const lines: string[] = ["# T-Minus profiler report", ""];
  for (const a of analyses) lines.push(...reportRun(a));
  if (comparison) lines.push(...reportComparison(comparison));
  return lines.join("\n");
}
