// An addon whose Awake (or Start, in diagnostic mode) takes long, in the Countdown or a Hold.
//
// The profiler writes per-addon aggregates at each checkpoint (a loader done,
// a scene ready, a transition complete), covering the calls since the
// previous checkpoint. A record's place is the phase that stretch overlaps.

import { phaseOf } from "../model.js";
import { modOfAssembly } from "../mods.js";
import type { Run } from "../run.js";
import type { Evidence, Finding, Place, Rule, Where } from "./types.js";

/** An addon needs at least this much time in one method, over the session. */
const MIN_MS = 1000;

const METHODS = [
  { family: "addon.awake", method: "Awake", note: undefined },
  {
    family: "addon.start",
    method: "Start",
    note: "Start times come from the profiler's diagnostic mode, which patches mod code: use them to compare addons, not as benchmark results.",
  },
];

const whereText = (w: Where) => (w.phase === "hold" ? `Hold ${w.hold}` : w.phase === "countdown" ? "the Countdown" : "between Holds");

export const expensiveAddon: Rule = {
  id: "expensive-addon",
  needs: "profiler",
  detects: "expensive addons: per-addon Awake time, and Start in diagnostic mode",
  run(run: Run): Finding[] {
    const aggregates = run.records.filter((r) => r.kind === "aggregate");
    // Aggregates follow their checkpoint mark and cover the stretch since the previous mark.
    const marks: number[] = run.records.filter((r) => r.kind === "mark" && r.name === "checkpoint").map((r) => r.t);
    const placeOf = (t: number): Where => {
      const i = marks.filter((m) => m <= t).length - 1;
      const to = i >= 0 ? marks[i] : t;
      const from = i > 0 ? marks[i - 1] : 0;
      const p = phaseOf(run, from, to - from);
      return p.phase === "hold" ? { phase: "hold", hold: p.hold } : { phase: p.phase === "countdown" ? "countdown" : "session" };
    };

    return METHODS.flatMap(({ family, method, note }) => {
      const byAddon = new Map<string, { ms: number; calls: number; places: Map<string, Place> }>();
      for (const r of aggregates.filter((r) => r.name === family && !String(r.detail).startsWith("(other"))) {
        const e = byAddon.get(r.detail) ?? { ms: 0, calls: 0, places: new Map() };
        e.ms += r.total;
        e.calls += r.count ?? 0;
        const where = placeOf(r.t);
        const p = e.places.get(whereText(where)) ?? { where, seconds: 0 };
        p.seconds += r.total / 1000;
        e.places.set(whereText(where), p);
        byAddon.set(r.detail, e);
      }

      return [...byAddon].flatMap(([key, { ms, calls, places }]) => {
        if (ms < MIN_MS) return [];
        const [assembly, type] = key.includes("/") ? key.split("/", 2) : [undefined, key];
        // The mod by its GameData folder when KSP.log lists the assembly; else the assembly name.
        const installed = assembly === undefined ? undefined : modOfAssembly(run, assembly);
        const mod = installed?.name ?? assembly;
        const shownMod = installed && installed.name !== installed.assembly ? `${installed.assembly} in ${installed.folder}` : assembly;
        const ranked = [...places.values()].sort((a, b) => b.seconds - a.seconds);
        const where = ranked.length === 1 ? ranked[0].where : { phase: "session" as const };
        const evidence: Evidence[] = ranked.map((p) => ({
          source: "profiler",
          text: `${family} ${key}: ${Math.round(p.seconds * 1000)} ms in ${whereText(p.where)}`,
        }));
        const notes = [`${calls} call${calls === 1 ? "" : "s"} over the session.`];
        if (note) notes.push(note);
        return [
          {
            id: this.id,
            title: `Expensive addon ${method}: ${type}${shownMod ? ` (${shownMod})` : ""}${ranked.length === 1 ? ` in ${whereText(ranked[0].where)}` : ""}`,
            subject: mod ?? type,
            where,
            places: ranked,
            cost: { kind: "measured", seconds: ms / 1000, method: `profiler: total time in ${type}.${method}` },
            evidence,
            action: `If the cost matters to you, report it to the authors of ${mod ?? type} with the profiler's .jsonl, and decide whether the mod is worth its cost.`,
            confidence: "measured",
            notes,
          },
        ];
      });
    });
  },
};
