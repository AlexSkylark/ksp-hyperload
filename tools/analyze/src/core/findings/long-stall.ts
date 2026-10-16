// A long stall in the Countdown or a Hold, attributed to a mod by the log lines around it.
//
// With the profiler: log gaps inside long frames (the game was stalled).
// KSP.log only: log gaps inside the Holds the log can delimit (space center
// and flight entry, through ShowUI). Either way the attribution is a guess:
// the work happened after the line before the gap and before the line after
// it, and either side may have done it.

import { LONG_FRAME_MS, MIN_GAP_SECONDS, gaps, phaseOf, sourceOf, type Gap } from "../model.js";
import { modOfSource, modRef, type Mod } from "../mods.js";
import type { Run } from "../run.js";
import type { Evidence, Facts, Finding, Place, Rule, Where } from "./types.js";

/** A mod needs at least this much silence next to its lines, per Countdown or Hold. */
const MIN_MOD_SECONDS = 2;
/** KSP.log only: without frames, count only gaps at least this long. */
const LOG_ONLY_MIN_GAP_SECONDS = 2;
/** Gaps shown as evidence per finding. */
const EVIDENCE_GAPS = 3;

interface Window {
  where: Where;
  from: number;
  to: number;
  minGap: number;
  /** Profiler evidence for the window, when there is a frame. */
  frame?: string;
}

function windows(run: Run, facts: Facts): Window[] {
  if (facts.input.level === "log") {
    return facts.holds
      .filter((h) => h.logFrom !== undefined && h.logTo !== undefined)
      .map((h) => ({ where: { phase: "hold" as const, hold: h.label }, from: h.logFrom!, to: h.logTo!, minGap: LOG_ONLY_MIN_GAP_SECONDS }));
  }
  if (run.processStartLogT === undefined) return [];
  const start = run.processStartLogT;
  return run.records
    .filter((r) => r.kind === "span" && r.name === "frame.long" && r.dur >= LONG_FRAME_MS)
    .flatMap((f) => {
      const p = phaseOf(run, f.t, f.dur);
      if (p.phase === "between") return [];
      const from = start + f.t / 1000;
      return [{ where: p.phase === "hold" ? { phase: "hold" as const, hold: p.hold } : { phase: "countdown" as const }, from, to: from + f.dur / 1000, minGap: MIN_GAP_SECONDS, frame: `frame.long ${f.detail}: ${(f.dur / 1000).toFixed(1)} s` }];
    });
}

/** The mod(s) next to a gap: both sides when they are different mods. */
function attribute(run: Run, g: Gap): { name: string; mods: Mod[] } | undefined {
  const a = modOfSource(run, sourceOf(g.before.text));
  const b = modOfSource(run, sourceOf(g.after.text));
  if (a && b && a.name !== b.name) return { name: `${a.name} or ${b.name}`, mods: [a, b] };
  const m = a ?? b;
  return m && { name: m.name, mods: [m] };
}

const whereText = (w: Where) => (w.phase === "hold" ? `Hold ${w.hold}` : "the Countdown");

export const longStallByMod: Rule = {
  id: "long-stall-by-mod",
  needs: "log",
  detects: "long stalls attributed to a mod",
  run(run: Run, facts: Facts): Finding[] {
    // One finding per mod, over the Countdown and every Hold.
    const byMod = new Map<string, { mods: Mod[]; gaps: Gap[]; frames: Map<number, string>; places: Map<string, Place> }>();
    for (const w of windows(run, facts)) {
      for (const g of gaps(run, w.from, w.to, w.minGap)) {
        const who = attribute(run, g);
        if (!who) continue;
        const mod = who.name;
        const e = byMod.get(mod) ?? { mods: who.mods, gaps: [] as Gap[], frames: new Map<number, string>(), places: new Map() };
        e.gaps.push(g);
        if (w.frame) e.frames.set(w.from, w.frame);
        const place = e.places.get(whereText(w.where)) ?? { where: w.where, seconds: 0 };
        place.seconds += g.seconds;
        e.places.set(whereText(w.where), place);
        byMod.set(mod, e);
      }
    }

    const profiler = facts.input.level !== "log";
    return [...byMod].flatMap(([mod, { mods, gaps: gs, frames, places }]) => {
      const seconds = gs.reduce((s, g) => s + g.seconds, 0);
      if (seconds < MIN_MOD_SECONDS) return [];
      const evidence: Evidence[] = [...frames.values()].map((text) => ({ source: "profiler", text }));
      for (const g of [...gs].sort((a, b) => b.seconds - a.seconds).slice(0, EVIDENCE_GAPS)) {
        evidence.push({ source: "log", line: g.before.n, text: g.before.text });
        evidence.push({ source: "log", line: g.after.n, text: `[${g.seconds.toFixed(1)} s later] ${g.after.text}` });
      }
      const ranked = [...places.values()].sort((a, b) => b.seconds - a.seconds);
      const where: Where = ranked.length === 1 ? ranked[0].where : { phase: "session" };
      const placesText = ranked.length === 1 ? whereText(ranked[0].where) : ranked.length === 2 ? `${whereText(ranked[0].where)} and ${whereText(ranked[1].where)}` : `${ranked.length} places`;
      const notes: string[] = [];
      if (!profiler) notes.push("KSP.log only: no frame data, so this does not show whether the game was stalled or busy over several frames.");
      return [
        {
          id: this.id,
          title: `Long ${profiler ? "frame" : "stall"}${(profiler ? frames.size : gs.length) > 1 ? "s" : ""} in ${placesText} attributed to ${mod}`,
          subject: mod,
          mods: mods.map((m) => modRef(m, mods.length === 1 ? "culprit" : "candidate")),
          where,
          places: ranked,
          cost: {
            kind: "estimated",
            seconds,
            method: profiler
              ? `sum of ${gs.length} log gap${gs.length > 1 ? "s" : ""} (≥ ${MIN_GAP_SECONDS} s) inside long frames, next to this mod's log lines`
              : `sum of ${gs.length} log gap${gs.length > 1 ? "s" : ""} (≥ ${LOG_ONLY_MIN_GAP_SECONDS} s) inside Holds, next to this mod's log lines`,
          },
          evidence,
          action: `Check the evidence first: the attribution is a guess from the log lines around each silence. If it holds, report it to the authors of ${mod} with this KSP.log, and decide whether the mod is worth its cost.`,
          confidence: "heuristic",
          notes: notes.length ? notes : undefined,
        },
      ];
    });
  },
};
