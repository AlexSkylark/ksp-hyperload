// Words the renderers share: scene and Hold names, places, input levels.

import type { InputLevel } from "../core/findings/index.js";

export { holdName, sceneName } from "../core/scenes.js";
/** A place in plain words: "the Countdown", "Editor → Flight", "between Holds", "the Holds". */
export { whereText as placeName } from "../core/findings/places.js";

export const LEVEL_NAME: Record<InputLevel, string> = {
  log: "KSP.log only",
  "log+summary": "KSP.log with T-Minus' summary",
  "log+profiler": "KSP.log and T-Minus' profiler records",
};

/** How the Countdown's seconds were obtained. */
export const COUNTDOWN_SOURCE = {
  profiler: "from process start to the main menu's first frame (T-Minus' profiler)",
  log: "from the log's first line to the main menu's first frame (KSP.log; the game's start before its first line is not in it)",
} as const;

/** "1.2 s"; "< 0.1 s" under a twentieth of a second. */
export const seconds = (s: number) => (s < 0.05 ? "< 0.1 s" : `${s.toFixed(1)} s`);

const pad = (n: number) => String(n).padStart(2, "0");

/** Hours, minutes and seconds of a duration, rounded to the second. */
function hms(s: number): [number, number, number] {
  const t = Math.round(s);
  return [Math.floor(t / 3600), Math.floor((t % 3600) / 60), t % 60];
}

/** "38.7 s" under a minute; "4:40" (or "1:04:40") from a minute on. */
export function duration(s: number): string {
  if (s < 60) return seconds(s);
  const [h, m, ss] = hms(s);
  return h ? `${h}:${pad(m)}:${pad(ss)}` : `${m}:${pad(ss)}`;
}

/** The mission clock: "T–04:40". */
export function clock(s: number): string {
  const [h, m, ss] = hms(s);
  return h ? `T–${h}:${pad(m)}:${pad(ss)}` : `T–${pad(m)}:${pad(ss)}`;
}

/** A sentence's start: "part compilation" → "Part compilation". */
export const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** KSP's version as players write it: "1.12.5" from "1.12.5.3190 (WindowsPlayer x64)". */
export const kspVersion = (r: { run: { system?: { ksp?: string } } }) => /^\d+(?:\.\d+){0,2}/.exec(r.run.system?.ksp ?? "")?.[0];

/** The report's parts, each with its plain gloss: a thematic name never appears in a header without it. */
export const PART_NAME = { countdown: "Countdown", holds: "Holds" } as const;
export const PART_GLOSS = { countdown: "startup time", holds: "scene transitions" } as const;
export const partTitle = (part: keyof typeof PART_NAME) => `${PART_NAME[part]} (${PART_GLOSS[part]})`;

/** The chip each remedy shows. */
export const REMEDY_CHIP = { fix: "fixable", "trade-off": "trade-off", report: "report to its authors", none: "info" } as const;

/** A cost: "54.1 s", a likely one "≈32.0 s" (the copied summary uses "~"). */
export function cost(s: number | undefined, certainty: "measured" | "likely" | undefined, likelyMark = "≈"): string {
  if (s === undefined) return "not measured";
  return `${certainty === "likely" ? likelyMark : ""}${seconds(s)}`;
}

/** Measured, likely and within seconds, side by side and never added: "3.3 s + ≈11.8 s". */
export function totals(t: { measured: number; likely: number }, likelyMark = "≈"): string {
  const parts = [t.measured > 0 ? seconds(t.measured) : "", t.likely > 0 ? `${likelyMark}${seconds(t.likely)}` : ""].filter(Boolean);
  return parts.join(" + ") || "no number";
}
