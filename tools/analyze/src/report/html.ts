// The report page: mockup v3 revision 5's structure, every text from the
// report model. Pure: a string in, a string out, everything escaped. The page
// reads without JavaScript: all parts are shown one after the other, and the
// controls that need a script (tabs, buttons, raw search) stay hidden until the
// page's script (step 3) shows them.

import type { HoldRow, ModGroup, Part, Ranked, Report, Stage, Totals } from "./model.js";
import { secondsIn, TOP } from "./model.js";
import { rawNumber, type RawBlock, type RawCell, type RawColumn, type RawFinding, type RawGroup, type RawSection, type RawSource } from "./raw.js";
import { alsoIn, followersText, headline, howText, withinText } from "./sentences.js";
import { STYLE } from "./style.js";
import { renderSummary } from "./text.js";
import { capital, clock, cost, duration, kspVersion, PART_GLOSS, PART_NAME, placeName, REMEDY_CHIP, seconds, totals } from "./wording.js";

const ENTITY: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
/** Text for HTML, in content or in a quoted attribute. */
export const esc = (v: unknown) => String(v ?? "").replace(/[&<>"']/g, (c) => ENTITY[c]);

const pct = (x: number, of: number) => `${of > 0 ? Math.max(0, Math.min(100, (x / of) * 100)).toFixed(1) : "0"}%`;
const gloss = (part: Part) => `${PART_NAME[part].toUpperCase()} <span class="gloss">(${PART_GLOSS[part]})</span>`;

function win(id: string, title: string, small: string, body: string, bodyClass = "body"): string {
  return `<section class="win" aria-labelledby="${id}"><div class="bar"><span id="${id}">${title}</span><small>${small}</small></div><div class="${bodyClass}">${body}</div></section>`;
}

// ---------------------------------------------------------------- summary

function summary(r: Report): string {
  const cd = r.headline.countdown;
  const ksp = kspVersion(r);
  const clockBox = `<div class="met well"><div class="lbl">STARTUP TIME</div><div class="t">${cd ? esc(clock(cd.seconds)) : "T–??:??"}</div><div class="lbl" style="margin-top:6px">${
    cd?.source === "log" ? "LOG'S FIRST LINE → MAIN MENU" : "LAUNCH → MAIN MENU"
  }</div></div>`;
  const verdict = headline(r)
    .map((s) => (s.strong ? `<b>${esc(s.text)}</b>` : esc(s.text)))
    .join("");
  const sys = r.run.system;
  const tags = [
    ksp ? `KSP ${ksp}` : "",
    r.run.assemblyCount !== undefined ? `${r.run.assemblyCount} assemblies` : "",
    r.run.kspcf ? `KSPCF ${r.run.kspcf}` : "",
    sys?.cpu ?? "",
    sys?.gpu ?? "",
    sys?.ramMb !== undefined ? `${(sys.ramMb / 1024).toFixed(0)} GB RAM` : "",
  ]
    .filter(Boolean)
    .map((t) => `<span class="tag">${esc(t)}</span>`);
  tags.push(`<span class="tag${r.run.level === "log+profiler" ? " ok" : ""}">Input: ${esc(r.run.levelName)}</span>`);
  const notices = r.notices
    .map((n) => `<div class="notice" style="grid-column:1/-1">${esc(n.text)}${n.items?.length ? `<ul>${n.items.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>` : ""}</div>`)
    .join("");
  return `<section class="win clockwin" aria-label="Summary">
<div class="bar"><span>T-MINUS FLIGHT REPORT</span><small>${ksp ? `KSP ${esc(ksp)} · ` : ""}one run</small></div>
<div class="body">
<div class="clocks">${clockBox}</div>
<p class="verdict">${verdict}</p>
${notices}
<div class="facts">${tags.join("")}</div>
<div class="facts btns" style="grid-column:1/-1" hidden>
<button class="kbtn go" id="btn-summary" type="button">COPY SUMMARY</button>
<button class="kbtn" id="btn-download" type="button">DOWNLOAD</button>
<span id="toast" role="status" aria-live="polite"></span>
</div>
<p class="hint" style="grid-column:1/-1" hidden>To share the report, use Download: it saves this page without your KSP.log or the Raw data tab, with usernames and paths removed. For Discord or the KSP forum, use Copy summary.</p>
</div>
</section>`;
}

function tabs(r: Report, raw: boolean): string {
  const holds = r.holds.rows.reduce((s, h) => s + h.seconds, 0);
  const tab = (id: string, panel: string, label: string, extra: string, on: boolean) =>
    `<button class="tab" id="${id}" role="tab" aria-selected="${on}" aria-controls="${panel}"${on ? "" : ' tabindex="-1"'}>${label}${extra}</button>`;
  return `<div class="tabs" id="tabs" role="tablist" aria-label="Report sections" hidden>
${tab("tab-startup", "startup", gloss("countdown"), r.countdown.seconds !== undefined ? ` <span class="mono">${esc(duration(r.countdown.seconds))}</span>` : "", true)}
${r.holds.rows.length ? tab("tab-transitions", "transitions", gloss("holds"), ` <span class="mono">${esc(duration(holds))}</span>`, false) : ""}
${raw ? tab("tab-raw", "raw", `RAW DATA <span class="gloss">(profiler + log)</span>`, "", false) : ""}
</div>`;
}

// ---------------------------------------------------------------- points and findings

const ICON = { fix: ["red", "!"], "trade-off": ["amber", "!"], report: ["cyan", "i"], none: ["cyan", "i"] } as const;
const CHIP_CLASS = { fix: "fix", "trade-off": "trade", report: "info", none: "info" } as const;

function chips(r: Report, i: number): string {
  const f = r.findings[i];
  const remedy = `<span class="chip ${CHIP_CLASS[f.remedy]}">${esc(REMEDY_CHIP[f.remedy])}</span>`;
  return f.certainty === "likely" ? `${remedy}<span class="chip likely">likely</span>` : remedy;
}

function point(r: Report, i: number, part: Part): string {
  const f = r.findings[i];
  const likely = f.certainty === "likely";
  const [tone, glyph] = likely ? ["likely", "?"] : ICON[f.remedy];
  const rest = [followersText(r, i, part), alsoIn(f, part)].filter(Boolean).join(" ");
  return `<div class="er-row well"><span class="er-ico ${tone}" aria-hidden="true">${glyph}</span>
<h3>${esc(f.title)}${chips(r, i)}</h3>
<span class="cost ${likely ? "amber" : tone}">${esc(cost(secondsIn(f, part), f.certainty))}</span><p><b>${esc(f.action)}</b>${rest ? ` ${esc(rest)}` : ""}</p></div>`;
}

function evidence(r: Report, i: number): string {
  const f = r.findings[i];
  const lines = f.evidence.map((e) => `${(e.source === "log" ? `KSP.log:${e.line ?? ""}` : "profiler").padEnd(14)} ${e.text}`);
  if (f.moreEvidence) lines.push(`… ${f.moreEvidence} more line${f.moreEvidence === 1 ? "" : "s"}`);
  return lines.length ? `<pre class="ev well">${esc(lines.join("\n"))}</pre>` : "";
}

function finding(r: Report, i: number, part: Part): string {
  const f = r.findings[i];
  const places =
    part === "holds"
      ? f.places.filter((p) => p.where.phase !== "countdown").map((p) => `<span>${esc(placeName(p.where))} ${esc(cost(p.seconds, f.certainty))}</span>`)
      : [];
  const also = alsoIn(f, part);
  if (also) places.push(`<span>${esc(also)}</span>`);
  const within = withinText(r, f);
  return `<div class="fnd"><h4>${esc(f.title)}${chips(r, i)}</h4><p class="act">${esc(f.action)}</p>
${places.length ? `<div class="places">${places.join("")}</div>` : ""}${within ? `<p class="within">${esc(within)}</p>` : ""}${f.notes.map((n) => `<p class="how">${esc(n)}</p>`).join("")}<p class="how">${esc(howText(f))}</p>${evidence(r, i)}</div>`;
}

// ---------------------------------------------------------------- resources

const span = (t: Totals) => t.measured + t.likely + t.within;

function restRow(rest: Ranked<unknown>["rest"], raw: boolean): string {
  if (!rest) return "";
  const within = rest.within > 0 ? `; ${seconds(rest.within)} inside other costs` : "";
  return `<div class="more-row"><span>${rest.count} more, ${esc(totals(rest))}${esc(within)}</span>${raw ? `<button class="kbtn sm" type="button" data-raw="" hidden>OPEN RAW DATA</button>` : ""}</div>`;
}

function group(r: Report, g: ModGroup, part: Part, scale: number): string {
  const note = g.kind === "install" ? "install-wide" : g.folder ? `GameData/${g.folder}` : "";
  const main = g.measured + g.likely > 0 ? totals(g) : "—";
  const within = g.within > 0 ? `<small>${esc(seconds(g.within))} inside another cost</small>` : "";
  return `<details class="r"><summary><span class="rname">${esc(capital(g.name))}${note ? `<small>${esc(note)}</small>` : ""}</span>
<span class="gauge rgauge" aria-hidden="true"><span class="m" style="width:${pct(g.measured, scale)}"></span><span class="l" style="width:${pct(g.likely, scale)}"></span><span class="w" style="width:${pct(g.within, scale)}"></span></span>
<span class="rval">${esc(main)}${within}</span></summary>
<div class="rbody">${g.findings.map((i) => finding(r, i, part)).join("")}</div></details>`;
}

function resources(r: Report, part: Part, raw: boolean): string {
  const g = r[part].groups;
  if (!g.top.length) return `<p class="rawnote">Nothing above the report's thresholds.</p>`;
  const scale = Math.max(...g.top.map(span));
  return `<div class="res well">${g.top.map((x) => group(r, x, part, scale)).join("")}${restRow(g.rest, raw)}</div>`;
}

function engineer(r: Report, part: Part): string {
  const p = r[part].points;
  return p.length ? p.map((i) => point(r, i, part)).join("") : `<p class="rawnote">Nothing in this part needs a look first.</p>`;
}

// ---------------------------------------------------------------- countdown

function stages(list: Stage[]): string {
  const max = Math.max(...list.map((s) => s.seconds));
  return list
    .map(
      (s, i) =>
        `<div class="stage ${s.kind}" title="${esc(s.label)}: ${esc(seconds(s.seconds))}"><span class="num">${list.length - 1 - i}</span><span class="nm">${esc(s.label)}<i style="width:${pct(Math.max(s.seconds, max / 100), max)}"></i></span><span class="s">${esc(seconds(s.seconds))}</span></div>`,
    )
    .join("");
}

function countdown(r: Report, raw: boolean): string {
  const c = r.countdown;
  const st = c.stages.length
    ? win(
        "h-stg",
        `${gloss("countdown").replace("COUNTDOWN", "COUNTDOWN STAGES")}`,
        `<span class="mono">${esc(seconds(c.stages.reduce((s, x) => s + x.seconds, 0)))} from the log's first line</span>`,
        `<div class="stack" id="stack">${stages(c.stages)}</div><div class="legend"><span><i style="background:var(--dim)"></i>KSP itself</span><span><i style="background:var(--cyan)"></i>mod code runs here</span><span><i style="background:var(--red)"></i>waiting for ModuleManager</span></div>`,
      )
    : "";
  return `<div class="part" id="startup" role="tabpanel" aria-labelledby="tab-startup">
<div class="banner"><h2>${gloss("countdown")}</h2><span class="mono">${c.seconds !== undefined ? esc(clock(c.seconds)) : "not measured"}</span><p>From launching KSP to the main menu. Paid once per game session.</p></div>
${win("h-er-s", `ENGINEER'S REPORT: ${gloss("countdown")}`, "what to look at first", engineer(r, "countdown"), "body er")}
${st}
${win("h-res-s", `RESOURCES: COUNTDOWN TIME BY MOD <span class="gloss">(startup time)</span>`, "solid: measured · striped: likely, guessed from the log", resources(r, "countdown", raw))}
</div>`;
}

// ---------------------------------------------------------------- holds

function holdRow(r: Report, h: HoldRow, slowest: number, phases: Stage[] | undefined): string {
  const row = (who: string, s: string, cls = "") => `<div class="hd-row${cls}"><span>${who}</span><span class="s">${s}</span></div>`;
  const dim = (who: string, s = "") => `<div class="hd-row" style="color:var(--dim)"><span>${esc(who)}</span><span class="s">${esc(s)}</span></div>`;
  const rows = h.costs.top.map((c) => {
    const f = r.findings[c.finding];
    const who = capital(f.cause);
    return row(esc(who), esc(cost(c.seconds, c.certainty)), c.certainty === "likely" ? " likely" : "");
  });
  const body = [
    ...(rows.length ? rows : [dim("Nothing above the report's thresholds.")]),
    ...(h.costs.rest ? [dim(`${h.costs.rest.count} more`, totals(h.costs.rest))] : []),
    ...(rows.length ? [dim(`Not measured${h.likely > 0 ? `: the likely costs above (≈${seconds(h.likely)}) fall inside it` : ""}`, seconds(h.unmeasured))] : []),
    ...(h.source === "ShowUI" ? [dim("Timed to KSP's ShowUI line, without the profiler")] : []),
    ...(phases?.length ? [`<div class="hd-sub">By phase</div>`, ...phases.map((p) => dim(p.label, seconds(p.seconds)))] : []),
  ];
  const color = h.seconds === slowest ? "var(--amber)" : "var(--cyan)";
  return `<details class="hd"><summary><span>${esc(h.name)}</span><span class="gauge"><span style="width:${pct(h.seconds, slowest)};background:${color}"></span></span><span class="s">${esc(seconds(h.seconds))}</span></summary>
<div class="hd-body">${body.join("")}</div></details>`;
}

function holds(r: Report, raw: boolean): string {
  const h = r.holds;
  if (!h.rows.length) return "";
  const total = h.rows.reduce((s, x) => s + x.seconds, 0);
  const slowest = Math.max(...h.rows.map((x) => x.seconds));
  // Flight entries go under the Hold they belong to: the i-th entry of a label under the i-th Hold of that label.
  const seen: Record<string, number> = {};
  const rows = h.rows.map((row) => {
    const n = (seen[row.label] = (seen[row.label] ?? -1) + 1);
    const entry = h.flightEntries.filter((e) => e.label === row.label)[n];
    return holdRow(r, row, slowest, entry?.stages);
  });
  return `<div class="part tr" id="transitions" role="tabpanel" aria-labelledby="tab-transitions">
<div class="banner"><h2>${gloss("holds")}</h2><span class="mono">${esc(duration(total))}</span><p>Each change of scene after the main menu: Space Center, Editor, Flight, Tracking Station. Paid every time you switch.</p></div>
${win("h-er-t", `ENGINEER'S REPORT: ${gloss("holds")}`, "what to look at first", engineer(r, "holds"), "body er")}
${win("h-holds", gloss("holds"), "open one to see what it spent its time on", `<div class="res well" id="holds">${rows.join("")}</div>`)}
${win("h-res-t", `RESOURCES: HOLD TIME BY MOD <span class="gloss">(scene transitions)</span>`, "solid: measured · striped: likely, guessed from the log", resources(r, "holds", raw))}
</div>`;
}

// ---------------------------------------------------------------- raw data

const SOURCE: Record<RawSource, [string, string]> = { profiler: ["p", "profiler"], log: ["l", "KSP.log"], analyzer: ["a", "analyzer"] };
const src = (s: RawSource) => `<span class="src ${SOURCE[s][0]}">${SOURCE[s][1]}</span>`;
const kv = (pairs: [string, string][]) => `<dl class="kv well">${pairs.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("")}</dl>`;

function cell(v: RawCell, c: RawColumn | undefined): string {
  if (v === null) return "";
  if (typeof v === "number") return esc(rawNumber(v, c));
  return esc(v).replace(/\n/g, "<br>");
}

function rawFinding(f: RawFinding): string {
  const c = f.seconds === undefined ? "not measured" : `${f.cost === "measured" ? "" : "≈"}${f.seconds.toFixed(1)} s`;
  const meta = [f.id, f.place, f.cost, f.confidence, ...(f.informational ? ["informational"] : [])].join(" · ");
  const pairs: [string, string][] = [
    ["Subject", f.subject ?? "—"],
    ["Cost method", f.method],
    ["Action", f.action],
    ...(f.within ? ([["Within", f.within]] as [string, string][]) : []),
    ...f.notes.map((n) => ["Note", n] as [string, string]),
  ];
  const ev = f.evidence.map((e) => `${e.source.padEnd(8)} ${e.line === undefined ? "      " : String(e.line).padStart(6)}  ${e.text}`).join("\n");
  return `<details class="fd"><summary><span>${esc(f.title)}</span><span class="mono">${esc(c)}</span><small>${esc(meta)}</small></summary>${kv(pairs)}<pre class="ev well">${esc(ev)}</pre></details>`;
}

function block(b: RawBlock): string {
  if (b.kind === "pairs") return kv(b.pairs);
  if (b.kind === "findings") return `<div class="fdl">${b.findings.map(rawFinding).join("")}</div>`;
  const cls = (c: RawBlock & { kind: "table" }, i: number) => [c.columns[i].digits !== undefined ? "n" : "", c.columns[i].wrap ? "wrap" : ""].filter(Boolean).join(" ");
  return `<div class="rt-box"><div class="rt-wrap well"><table class="rt"><thead><tr>${b.columns.map((c, i) => `<th class="${cls(b, i)}">${esc(c.title)}</th>`).join("")}</tr></thead><tbody>${b.rows
    .map((row) => `<tr>${row.map((v, i) => `<td class="${cls(b, i)}">${cell(v, b.columns[i])}</td>`).join("")}</tr>`)
    .join("")}</tbody></table></div><div class="rt-count">${b.rows.length} row${b.rows.length === 1 ? "" : "s"}</div></div>`;
}

function rawSection(s: RawSection): string {
  return `<details class="win rawsec"${s.open ? " open" : ""}><summary class="bar"><span>${esc(s.title.toUpperCase())}</span><span>${s.from.map(src).join(" ")}</span></summary><div class="body">${
    s.note ? `<p class="rawnote">${esc(s.note)}</p>` : ""
  }${s.blocks.map(block).join("")}</div></details>`;
}

const rowCount = (groups: RawGroup[]) =>
  groups.reduce((n, g) => n + g.sections.reduce((m, s) => m + s.blocks.reduce((k, b) => k + (b.kind === "table" ? b.rows.length : 0), 0), 0), 0);

function rawPart(groups: RawGroup[]): string {
  const host = groups
    .map(
      (g) =>
        `<div class="rawgrp"><h3 id="${esc(g.id)}">${esc(g.title.toUpperCase())}${g.gloss ? ` <span class="gloss">(${esc(g.gloss)})</span>` : ""}</h3><p class="rawnote">${esc(g.note)}</p>${g.sections.map(rawSection).join("")}</div>`,
    )
    .join("");
  const index = groups.map((g) => `<button class="kbtn sm" type="button" data-to="${esc(g.id)}">${esc(g.title.toUpperCase())}</button>`).join("");
  return `<div class="part raw" id="raw" role="tabpanel" aria-labelledby="tab-raw">
<div class="banner"><h2>RAW DATA <span class="gloss">(profiler + log)</span></h2><span class="mono" id="raw-rows">${rowCount(groups).toLocaleString("en")} rows</span><p>Every number T-Minus read from this run, organized but not ranked or cut. The other tabs show the top ${TOP}; everything is here.</p></div>
<section class="win" aria-label="Search raw data" hidden><div class="bar"><span>SEARCH</span><small>filters every table below</small></div><div class="body">
<div class="rawsearch"><input id="raw-q" type="search" placeholder="Mod, folder, class, event…" aria-label="Search all raw data"><span class="rt-count" id="raw-count"></span></div>
<div class="rawidx" id="raw-idx">${index}</div></div></section>
<div id="raw-host" class="rawgrp" style="gap:22px">${host}</div>
</div>`;
}

// ---------------------------------------------------------------- page

export interface HtmlOptions {
  /** The Raw data tab's content; the local page has it, the downloaded report does not. */
  raw?: RawGroup[];
  /** CSS put before the page's own, for the embedded fonts (the page build makes it). */
  fonts?: string;
  /** The page's behavior, as one inline script (the page build makes it). */
  script?: string;
}

/** Text that ends a raw-text element (`<style>`, `<script>`) or opens an escaped section in it. */
const ENDS = { style: /<\/style/i, script: /<\/script|<!-{2}/i }; // "-{2}": the page's own script can hold neither

export function renderHtml(r: Report, options: HtmlOptions = {}): string {
  const raw = options.raw?.length ? options.raw : undefined;
  const { fonts = "", script = "" } = options;
  if (ENDS.style.test(fonts)) throw new Error("the fonts CSS would end its <style> element");
  if (ENDS.script.test(script)) throw new Error("the page script would end its <script> element");
  const summaryJson = JSON.stringify(renderSummary(r)).replace(/</g, "\\u003c");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>T-Minus Flight Report</title>
${fonts ? `<style>${fonts}</style>\n` : ""}<style>${STYLE}</style>
</head>
<body>
<div class="wrap">
${summary(r)}
${tabs(r, Boolean(raw))}
${countdown(r, Boolean(raw))}
${holds(r, Boolean(raw))}
${raw ? rawPart(raw) : `<p class="notice">This copy has no Raw data tab: the profiler records and log tables stay in the report on the player's computer, next to their KSP.log.</p>`}
</div>
<script type="application/json" id="tminus-summary">${summaryJson}</script>
${script ? `<script>${script}</script>\n` : ""}</body>
</html>
`;
}
