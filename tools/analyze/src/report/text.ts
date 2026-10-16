// The copied summary: plain text for a forum or Discord message. Built from
// the report model like the page, so it says the same thing. Likely costs are
// marked "~" (a "≈" pasted into chat reads as noise). It fits one Discord
// message: when it would not, the last points are left out.

import type { Part, Report } from "./model.js";
import { secondsIn } from "./model.js";
import { followersText, headline, holdsSentence, plain } from "./sentences.js";
import { cost, duration, kspVersion, PART_GLOSS, PART_NAME } from "./wording.js";

/** A Discord message's limit, in characters. */
export const SUMMARY_LIMIT = 2000;

/** An action's first sentence: the page has the rest. */
const firstSentence = (s: string) => /^.*?[.!?](?=\s|$)/.exec(s)?.[0] ?? s;

const pointLine = (r: Report, n: number, finding: number, part: Part) => {
  const f = r.findings[finding];
  const c = cost(secondsIn(f, part), f.certainty, "~");
  const guess = f.certainty === "likely" ? " (guessed from the log)" : "";
  const comes = followersText(r, finding, part).replace(/≈/g, "~");
  return `${n}. ${f.title}: ${c}${guess}.${comes ? ` ${comes}` : ""} ${firstSentence(f.action)}`;
};

const header = (part: Part) => `${PART_NAME[part].toUpperCase()} (${PART_GLOSS[part]})`;

function lines(r: Report, keep: Record<Part, number>): string[] {
  const ksp = kspVersion(r);
  const what = [ksp ? `KSP ${ksp}` : "", r.run.assemblyCount !== undefined ? `${r.run.assemblyCount} assemblies` : "", r.run.kspcf ? `KSPCF ${r.run.kspcf}` : ""].filter(Boolean);
  const out = [`T-Minus report${what.length ? `: ${what.join(", ")}` : ""}`, plain(headline(r)).replace(` ${holdsSentence(r)}`, "").replace(/≈/g, "~")];
  const cd = r.countdown.seconds;
  out.push(`${header("countdown")}: ${cd === undefined ? "not measured" : `${duration(cd)} to the main menu`}`);
  r.countdown.points.slice(0, keep.countdown).forEach((f, i) => out.push(pointLine(r, i + 1, f, "countdown")));
  if (r.holds.rows.length) {
    out.push(`${header("holds")}: ${holdsSentence(r).replace(/^[^:]*: /, "")}`);
    r.holds.points.slice(0, keep.holds).forEach((f, i) => out.push(pointLine(r, i + 1, f, "holds")));
  }
  const left = r.countdown.points.length - keep.countdown + r.holds.points.length - keep.holds;
  if (left > 0) out.push(`${left} more point${left === 1 ? "" : "s"} in the full report.`);
  return out;
}

export function renderSummary(r: Report): string {
  const keep: Record<Part, number> = { countdown: r.countdown.points.length, holds: r.holds.points.length };
  let text = lines(r, keep).join("\n");
  // Leave out the last point of the longer list until it fits; each part keeps its first point while it can.
  while (text.length > SUMMARY_LIMIT && keep.countdown + keep.holds > 0) {
    const part: Part = keep.holds > keep.countdown || (keep.holds === keep.countdown && keep.holds > 0) ? "holds" : "countdown";
    keep[part]--;
    text = lines(r, keep).join("\n");
  }
  return text.length > SUMMARY_LIMIT ? `${text.slice(0, SUMMARY_LIMIT - 1)}…` : text;
}
