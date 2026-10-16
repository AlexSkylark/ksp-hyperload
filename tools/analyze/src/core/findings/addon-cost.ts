// An addon whose Awake (or Start, in diagnostic mode) takes long, in the Countdown or a Hold.
// Per-addon aggregates are placed by their checkpoint (places.ts).

import { assemblyRef, isStockAssembly, modOfAssembly } from "../mods.js";
import type { Run } from "../run.js";
import type { Evidence, Finding, Place, Rule } from "./types.js";
import { addPlace, checkpointPlace, ranked as rankPlaces, whereText } from "./places.js";

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

export const expensiveAddon: Rule = {
  id: "expensive-addon",
  needs: "profiler",
  detects: "expensive addons: per-addon Awake time, and Start in diagnostic mode",
  run(run: Run): Finding[] {
    const aggregates = run.records.filter((r) => r.kind === "aggregate");
    const placeOf = checkpointPlace(run);

    return METHODS.flatMap(({ family, method, note }) => {
      const byAddon = new Map<string, { ms: number; calls: number; places: Map<string, Place> }>();
      for (const r of aggregates.filter((r) => r.name === family && !String(r.detail).startsWith("(other"))) {
        const e = byAddon.get(r.detail) ?? { ms: 0, calls: 0, places: new Map() };
        e.ms += r.total;
        e.calls += r.count ?? 0;
        addPlace(e.places, placeOf(r.t), r.total / 1000);
        byAddon.set(r.detail, e);
      }

      return [...byAddon].flatMap(([key, { ms, calls, places }]) => {
        if (ms < MIN_MS) return [];
        const [assembly, type] = key.includes("/") ? key.split("/", 2) : [undefined, key];
        // The mod by its GameData folder when KSP.log lists the assembly; else the assembly name.
        const installed = assembly === undefined ? undefined : modOfAssembly(run, assembly);
        const stock = !installed && assembly !== undefined && isStockAssembly(assembly);
        const mod = stock ? "stock KSP" : installed?.name ?? assembly;
        const shownMod = installed && installed.name !== installed.assembly ? `${installed.assembly} in ${installed.folder}` : mod;
        const ref = assembly === undefined ? undefined : assemblyRef(run, assembly, "culprit");
        const { places: ranked, where } = rankPlaces(places);
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
            mods: ref ? [ref] : undefined,
            where,
            places: ranked,
            cost: { kind: "measured", seconds: ms / 1000, method: `profiler: total time in ${type}.${method}` },
            evidence,
            action: stock
              ? `${type} is stock KSP code: nothing to change in the mods.`
              : `If the cost matters to you, report it to the authors of ${mod ?? type} with the profiler's .jsonl, and decide whether the mod is worth its cost.`,
            cause: `${type}'s ${method}`,
            remedy: stock ? "none" : "report",
            confidence: "measured",
            notes,
          },
        ];
      });
    });
  },
};
