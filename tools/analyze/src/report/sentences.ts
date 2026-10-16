// The generated sentences every renderer shares: the headline, a point's
// text, the Holds' summary. Built from the model's fields only, so the HTML,
// the Markdown and the copied summary say the same thing.

import type { ModGroup, Part, Report, ReportFinding } from "./model.js";
import { secondsIn } from "./model.js";
import { cost, duration, PART_GLOSS, PART_NAME, seconds } from "./wording.js";

/** A run of text; strong runs are what the reader should see first. */
export interface Segment {
  text: string;
  strong?: boolean;
}

export const plain = (segments: Segment[]) => segments.map((s) => s.text).join("");

/** The group a finding is listed in, in the first part that lists it. */
export function groupOf(r: Report, finding: number): ModGroup | undefined {
  for (const part of ["countdown", "holds"] as Part[]) {
    const g = r[part].groups.top.find((x) => x.findings.includes(finding));
    if (g) return g;
  }
  return undefined;
}

function partsPhrase(f: ReportFinding): string {
  return f.parts.map((p) => `the ${PART_NAME[p]}`).join(" and ") || "this run";
}

/** "Holds: 1:33 over 7; Editor → Flight is the slowest at 38.7 s." Empty without Holds. */
export function holdsSentence(r: Report): string {
  const rows = r.holds.rows;
  if (!rows.length) return "";
  const total = rows.reduce((s, h) => s + h.seconds, 0);
  const slowest = rows.reduce((a, b) => (b.seconds > a.seconds ? b : a));
  const over = `${PART_NAME.holds}: ${duration(total)} over ${rows.length}`;
  return rows.length > 1 ? `${over}; ${slowest.name} is the slowest at ${seconds(slowest.seconds)}.` : `${over}.`;
}

/**
 * The headline: the largest cost the player can act on, then the Holds.
 * "About 76 s of the Countdown comes from <cause>, in <group>."
 */
export function headline(r: Report): Segment[] {
  const out: Segment[] = [];
  const top = r.headline.top;
  if (top) {
    const f = r.findings[top.finding];
    const g = groupOf(r, top.finding);
    const inGroup = g && g.kind !== "install" ? `, in ${g.name}` : "";
    if (top.seconds !== undefined) {
      const about = `${top.certainty === "likely" ? "Likely about" : "About"} ${Math.round(top.seconds)} s`;
      out.push({ text: `${about} of ${partsPhrase(f)} comes from ` }, { text: f.cause, strong: true }, { text: `${inGroup}.` });
    } else out.push({ text: "The first thing to look at: " }, { text: f.cause, strong: true }, { text: `${inGroup}; its cost is not measured on this install.` });
  } else out.push({ text: "Nothing in this run can be fixed or traded off." });
  const holds = holdsSentence(r);
  if (holds) out.push({ text: ` ${holds}` });
  return out;
}

/** "Also 1.2 s in the Holds (scene transitions)." when the finding has seconds in the other part too. */
export function alsoIn(f: ReportFinding, part: Part): string {
  const other: Part = part === "countdown" ? "holds" : "countdown";
  const s = secondsIn(f, other);
  if (!s) return "";
  return `Also ${cost(s, f.certainty)} in the ${PART_NAME[other]} (${PART_GLOSS[other]}).`;
}

/** What follows from a finding, in a part: "Comes with: Drag cubes regenerated (22.3 s)." */
export function followersText(r: Report, finding: number, part: Part): string {
  const list = r.findings[finding].followers
    .map((j) => r.findings[j])
    .filter((g) => g.parts.includes(part))
    .map((g) => `${g.title} (${cost(secondsIn(g, part), g.certainty)})`);
  return list.length ? `Comes with: ${list.join("; ")}.` : "";
}

/** A point's text: its action, what comes with it, and its seconds in the other part. */
export function pointText(r: Report, finding: number, part: Part): string {
  const f = r.findings[finding];
  return [f.action, followersText(r, finding, part), alsoIn(f, part)].filter(Boolean).join(" ");
}

/** How a number was obtained: "Measured: ...", "Likely: ...", "Not measured: ...". */
export function howText(f: ReportFinding): string {
  const word = f.seconds === undefined ? "Not measured" : f.certainty === "measured" ? "Measured" : "Likely";
  return `${word}: ${f.method}.`.replace(/\.\.$/, ".");
}

/** A share of another finding's cost: "Part of ModuleManager patching from scratch's 54.1 s; counted there, never added." */
export function withinText(r: Report, f: ReportFinding): string {
  if (f.within === undefined) return "";
  const c = r.findings[f.within];
  return `Part of the cost of ${c.cause} (${cost(c.seconds, c.certainty)}): counted there, never added to it.`;
}
