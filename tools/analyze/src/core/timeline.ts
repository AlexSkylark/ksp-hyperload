// Where things fall in time: log silences, who wrote a line, and which part
// of the session (the Countdown, a Hold, between Holds) a moment belongs to.
// Apart from model.ts so the findings rules can use it: model.ts runs them.

import type { LogLine } from "./log.js";
import type { Run } from "./run.js";

/** Profiler frames at least this long are reported as long frames. */
export const LONG_FRAME_MS = 2000;
/** Log gaps at least this long count inside a long frame. */
export const MIN_GAP_SECONDS = 0.5;

/** Aggregate families, in report order. */

/** Where a profiler frame falls: in the Countdown, in a Hold (named), or between Holds. */
export interface FramePlace {
  phase: "countdown" | "hold" | "between";
  hold?: string;
}

/** Best guess of who wrote a log line: a [Tag], a "date,Mod," prefix, or a "Name:" prefix. */
export function sourceOf(text: string): string {
  let m = /^\[([^\]]{2,60})\]/.exec(text);
  if (m) return m[1].replace(/:.*/, "");
  m = /^\d+\/\d+\/\d+ [\d:]+ [AP]M,([^,]+),/.exec(text);
  if (m) return m[1];
  m = /^([A-Za-z][\w.-]{2,40})(\(|:)/.exec(text);
  if (m) return m[1];
  return text.slice(0, 40);
}

export interface Gap {
  seconds: number;
  before: LogLine;
  after: LogLine;
}

/** Silent stretches of at least minSeconds between log lines in [from, to]. */
export function gaps(run: Run, from: number, to: number, minSeconds: number): Gap[] {
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

/** Where a profiler frame falls: the Countdown ends when the main menu is ready. */
export function phaseOf(run: Run, t: number, dur: number): FramePlace {
  const transitions = run.records.filter((r) => r.kind === "span" && r.name === "scene.transition");
  const menu = transitions.find((r) => r.detail === "LOADING->MAINMENU");
  if (!menu || t < menu.t + menu.dur) return { phase: "countdown" };
  // A frame can start a few ms before the scene request that happens inside it.
  const hold = transitions.find((r) => r !== menu && t < r.t + r.dur && t + dur > r.t);
  return hold ? { phase: "hold", hold: hold.detail } : { phase: "between" };
}
