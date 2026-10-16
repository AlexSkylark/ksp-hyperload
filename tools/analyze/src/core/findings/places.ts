// Where a profiler aggregate's time falls, and how the report names a place.

import { phaseOf } from "../model.js";
import type { Run } from "../run.js";
import type { Place, Where } from "./types.js";

/** "Hold X", "the Countdown", or "between Holds". */
export const whereText = (w: Where) => (w.phase === "hold" ? `Hold ${w.hold}` : w.phase === "countdown" ? "the Countdown" : "between Holds");

/**
 * The profiler writes aggregates at each checkpoint (a loader done, a scene
 * ready, a transition complete), covering the calls since the previous
 * checkpoint. Returns the place of the stretch an aggregate at time t covers.
 */
export function checkpointPlace(run: Run): (t: number) => Where {
  const marks: number[] = run.records.filter((r) => r.kind === "mark" && r.name === "checkpoint").map((r) => r.t);
  return (t) => {
    const i = marks.filter((m) => m <= t).length - 1;
    const to = i >= 0 ? marks[i] : t;
    const from = i > 0 ? marks[i - 1] : 0;
    const p = phaseOf(run, from, to - from);
    return p.phase === "hold" ? { phase: "hold", hold: p.hold } : { phase: p.phase === "countdown" ? "countdown" : "session" };
  };
}

/** Adds seconds to a place in a map keyed by the place's text. */
export function addPlace(places: Map<string, Place>, where: Where, seconds: number): void {
  const p = places.get(whereText(where)) ?? { where, seconds: 0 };
  p.seconds += seconds;
  places.set(whereText(where), p);
}

/** Places largest first, and the finding's where: the single place, or the session. */
export function ranked(places: Map<string, Place>): { places: Place[]; where: Where } {
  const list = [...places.values()].sort((a, b) => b.seconds - a.seconds);
  return { places: list, where: list.length === 1 ? list[0].where : { phase: "session" } };
}
