// Markdown report: the report model in Markdown, with the same sentences as
// the page, then the raw data as an appendix ("Technical details") with its
// tables cut. No analysis here, only presentation.

import type { Comparison, RunAnalysis } from "../core/model.js";
import type { HoldRow, ModGroup, Part, Report, Stage } from "./model.js";
import { buildReport, secondsIn } from "./model.js";
import { buildRaw, rawNumber, type RawBlock, type RawCell, type RawColumn, type RawGroup } from "./raw.js";
import { redactor } from "./redact.js";
import { alsoIn, followersText, headline, howText, withinText } from "./sentences.js";
import { capital, clock, cost, duration, kspVersion, partTitle, placeName, REMEDY_CHIP, seconds, totals } from "./wording.js";

/** Rows shown per raw table in the appendix. */
const RAW_ROWS = 15;
/** Evidence lines shown per finding in the appendix. */
const RAW_EVIDENCE = 12;

const fmt = (n: number | undefined, digits = 2) => (n === undefined ? "—" : n.toFixed(digits));
/** A time cell: one decimal and its unit. */
const time = (n: number | undefined) => (n === undefined ? "—" : `${n.toFixed(1)} s`);
const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, "<br>");
/** Text inside a fenced block: a fence in it would end the block. */
const fenced = (s: string) => s.replace(/```/g, "'''");

const WHO: Record<Stage["kind"], string> = { stock: "KSP", mod: "KSP + mods", wait: "waiting for ModuleManager" };

function chips(r: Report, i: number): string {
  const f = r.findings[i];
  return [REMEDY_CHIP[f.remedy], ...(f.certainty === "likely" ? ["likely"] : [])].join(", ");
}

function points(r: Report, part: Part): string[] {
  const p = r[part].points;
  if (!p.length) return ["Nothing in this part needs a look first.", ""];
  const out = p.map((i, n) => {
    const f = r.findings[i];
    const rest = [followersText(r, i, part), alsoIn(f, part)].filter(Boolean).join(" ");
    return `${n + 1}. **${f.title}**: ${cost(secondsIn(f, part), f.certainty)} (${chips(r, i)}). ${f.action}${rest ? ` ${rest}` : ""}`;
  });
  return [...out, ""];
}

function finding(r: Report, i: number, part: Part): string[] {
  const f = r.findings[i];
  const out = [`- **${f.title}** (${chips(r, i)}): ${f.action}`];
  const places = part === "holds" ? f.places.filter((p) => p.where.phase !== "countdown") : [];
  if (places.length > 1 || (places.length === 1 && f.places.length > 1))
    out.push(`  - By place: ${places.map((p) => `${placeName(p.where)} ${cost(p.seconds, f.certainty)}`).join("; ")}.`);
  const also = alsoIn(f, part);
  if (also) out.push(`  - ${also}`);
  const within = withinText(r, f);
  if (within) out.push(`  - ${within}`);
  for (const n of f.notes) out.push(`  - ${n}`);
  out.push(`  - ${howText(f)}`);
  return out;
}

function groupLine(g: ModGroup): string {
  const note = g.kind === "install" ? " (install-wide)" : g.folder ? ` (GameData/${g.folder})` : "";
  const main = g.measured + g.likely > 0 ? totals(g) : "no cost of its own";
  return `**${capital(g.name)}**${note}: ${main}${g.within > 0 ? `, and ${seconds(g.within)} inside another cost` : ""}`;
}

function groups(r: Report, part: Part): string[] {
  const g = r[part].groups;
  if (!g.top.length) return ["Nothing above the report's thresholds.", ""];
  const out: string[] = [];
  for (const x of g.top) out.push(groupLine(x), "", ...x.findings.flatMap((i) => finding(r, i, part)), "");
  if (g.rest) out.push(`${g.rest.count} more, ${totals(g.rest)}${g.rest.within > 0 ? `; ${seconds(g.rest.within)} inside other costs` : ""}.`, "");
  return out;
}

function stages(list: Stage[], withWho: boolean): string[] {
  const out = [withWho ? "| # | Stage | Time | Who |" : "| Stage | Time |", withWho ? "|---|---|---|---|" : "|---|---|"];
  list.forEach((s, i) => out.push(withWho ? `| ${list.length - 1 - i} | ${cell(s.label)} | ${time(s.seconds)} | ${WHO[s.kind]} |` : `| ${cell(s.label)} | ${time(s.seconds)} |`));
  return [...out, ""];
}

function holdLine(r: Report, h: HoldRow): string {
  const costs = h.costs.top.slice(0, 3).map((c) => `${r.findings[c.finding].cause} ${cost(c.seconds, c.certainty)}`);
  const more = h.costs.top.length - costs.length + (h.costs.rest?.count ?? 0);
  return `| ${h.name} | ${time(h.seconds)} | ${cell(costs.join("; ") + (more > 0 ? `; ${more} more` : "")) || "—"} | ${time(h.unmeasured)} |`;
}

function header(r: Report): string[] {
  const sys = r.run.system;
  const ksp = kspVersion(r);
  const facts = [
    ksp ? `KSP ${ksp}` : "",
    r.run.assemblyCount !== undefined ? `${r.run.assemblyCount} assemblies` : "",
    r.run.kspcf ? `KSPCF ${r.run.kspcf}` : "",
    sys?.cpu ?? "",
    sys?.gpu ?? "",
    sys?.ramMb !== undefined ? `${(sys.ramMb / 1024).toFixed(0)} GB RAM` : "",
    `input: ${r.run.levelName}`,
  ].filter(Boolean);
  const out = [headline(r).map((s) => (s.strong ? `**${s.text}**` : s.text)).join(""), "", `- ${facts.join(" · ")}`, ""];
  for (const n of r.notices) {
    out.push(`> ${n.text}`);
    for (const i of n.items ?? []) out.push(`> - ${i}`);
    out.push("");
  }
  return out;
}

function countdown(r: Report): string[] {
  const c = r.countdown;
  const out = [`### ${partTitle("countdown")}: ${c.seconds !== undefined ? `${clock(c.seconds)}` : "not measured"}`, "", "From launching KSP to the main menu. Paid once per game session.", ""];
  out.push("#### What to look at first", "", ...points(r, "countdown"));
  if (c.stages.length)
    out.push(`#### Stages (${seconds(c.stages.reduce((s, x) => s + x.seconds, 0))} from the log's first line)`, "", ...stages(c.stages, true));
  out.push("#### Time by mod", "", ...groups(r, "countdown"));
  return out;
}

function holds(r: Report): string[] {
  const h = r.holds;
  if (!h.rows.length) return [`### ${partTitle("holds")}`, "", "No scene transition in this run.", ""];
  const total = h.rows.reduce((s, x) => s + x.seconds, 0);
  const out = [`### ${partTitle("holds")}: ${duration(total)}`, "", "Each change of scene after the main menu. Paid every time you switch.", ""];
  out.push("#### What to look at first", "", ...points(r, "holds"));
  out.push("#### Each Hold", "", "| Hold | Time | Largest costs | Not measured |", "|---|---|---|---|", ...h.rows.map((x) => holdLine(r, x)), "");
  for (const e of h.flightEntries) out.push(`**${e.name}, by phase**`, "", ...stages(e.stages, false));
  out.push("#### Time by mod", "", ...groups(r, "holds"));
  return out;
}

// ---------------------------------------------------------------- technical details

const SOURCE = { profiler: "profiler", log: "KSP.log", analyzer: "analyzer" } as const;

function rawCell(v: RawCell, c: RawColumn | undefined): string {
  if (v === null) return "";
  return typeof v === "number" ? rawNumber(v, c) : cell(v);
}

function rawBlock(b: RawBlock): string[] {
  if (b.kind === "pairs") return [...b.pairs.map(([k, v]) => `- ${k}: ${v}`), ""];
  if (b.kind === "findings")
    return b.findings.flatMap((f) => {
      const c = f.seconds === undefined ? "not measured" : `${f.seconds.toFixed(1)} s, ${f.cost}`;
      const out = [`**${f.title}**`, "", `- \`${f.id}\` · ${f.place} · ${c} · ${f.confidence}${f.informational ? " · informational" : ""}`, `- Cost method: ${f.method}`, `- Action: ${f.action}`];
      if (f.subject) out.push(`- Subject: ${f.subject}`);
      if (f.within) out.push(`- Within: ${f.within}`);
      for (const n of f.notes) out.push(`- ${n}`);
      out.push("", "```text");
      for (const e of f.evidence.slice(0, RAW_EVIDENCE)) out.push(fenced(e.line !== undefined ? `KSP.log:${e.line}  ${e.text}` : `profiler  ${e.text}`));
      if (f.evidence.length > RAW_EVIDENCE) out.push(`(${f.evidence.length - RAW_EVIDENCE} more)`);
      out.push("```", "");
      return out;
    });
  const out = [`| ${b.columns.map((c) => cell(c.title)).join(" | ")} |`, `|${b.columns.map((c) => (c.digits !== undefined ? "---:" : "---")).join("|")}|`];
  for (const row of b.rows.slice(0, RAW_ROWS)) out.push(`| ${row.map((v, i) => rawCell(v, b.columns[i])).join(" | ")} |`);
  if (b.rows.length > RAW_ROWS) out.push(`| (${b.rows.length - RAW_ROWS} more rows) |${" |".repeat(b.columns.length - 1)}`);
  return [...out, ""];
}

function technical(groups: RawGroup[]): string[] {
  const out = ["### Technical details", "", `What the report is built from. Tables show their first ${RAW_ROWS} rows; the page's Raw data tab has them all.`, ""];
  for (const g of groups) {
    out.push(`#### ${g.title}${g.gloss ? ` (${g.gloss})` : ""}`, "", g.note, "");
    for (const s of g.sections) {
      out.push(`##### ${s.title} (${s.from.map((f) => SOURCE[f]).join(", ")})`, "");
      if (s.note) out.push(s.note, "");
      for (const b of s.blocks) out.push(...rawBlock(b));
    }
  }
  return out;
}

export function reportRun(a: RunAnalysis): string[] {
  const r = buildReport(a);
  // The run's folder name only: the path it was read from can name the user.
  const name = redactor(a.identifying)(a.name.split(/[\\/]/).pop() || a.name);
  return [`## ${name}`, "", ...header(r), ...countdown(r), ...holds(r), ...technical(buildRaw(a))];
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
