// A mod whose PartModules and VesselModules take long to run.
//
// [C] KSP runs module code through stock, non-virtual entry points: a
// PartModule's Load (fields, upgrades, OnLoad) and Awake (OnAwake) as parts are
// compiled, created and loaded, its OnStart and OnStartFinished as a scene
// starts, and a VesselModule's Awake, Start and Load per vessel. The profiler
// times each by module type, "<assembly>/<type>" (docs/m5-profiler-plan.md,
// "Step 3"); the stages are separate calls, so they add up. The .jsonl has a
// family per stage; the summary (format 3) sums them per type and per assembly.
//
// Stock modules are left out: their cost is the game's, and grows with the
// parts in use. A module's time also holds what it calls (other mods' code
// included), so a mod can carry time it triggers but does not run.

import { assemblyOwner, assemblyRef, splitAssemblyKey } from "../mods.js";
import type { Run } from "../run.js";
import type { Evidence, Finding, Place, Rule } from "./types.js";
import { addPlace, checkpointPlace, possessive, ranked, refs, whereText } from "./places.js";

/** A mod needs at least this much module time over the session. Provisional (step 9). */
const MIN_MS = 1000;
/** Module types shown per mod. */
const EVIDENCE_TYPES = 5;

const STAGES: Record<string, string> = {
  "module.load": "Load",
  "module.awake": "Awake",
  "module.onStart": "OnStart",
  "module.onStartFinished": "OnStartFinished",
  "vesselModule.awake": "VesselModule Awake",
  "vesselModule.start": "VesselModule Start",
  "vesselModule.load": "VesselModule Load",
};
/** The summary's sums (format 3). */
const BY_TYPE = "module.byType";
const BY_ASSEMBLY = "module.byAssembly";

interface Type {
  ms: number;
  calls: number;
  stages: Map<string, { ms: number; calls: number }>;
}

interface Owner {
  ms: number;
  places: Map<string, Place>;
  types: Map<string, Type>;
}

export const expensivePartModules: Rule = {
  id: "expensive-part-modules",
  needs: "profiler",
  detects: "mods whose PartModules and VesselModules take long to run",
  run(run: Run): Finding[] {
    const placeOf = checkpointPlace(run);
    const aggregates = run.records.filter((r) => r.kind === "aggregate" && !String(r.detail).startsWith("(other"));
    const perStage = aggregates.some((r) => r.name in STAGES);
    const owners = new Map<string, Owner>();
    const ownerOf = (assembly: string) => {
      const o = owners.get(assembly) ?? { ms: 0, places: new Map(), types: new Map() };
      owners.set(assembly, o);
      return o;
    };

    for (const r of aggregates) {
      const stage = perStage ? STAGES[r.name] : r.name === BY_TYPE ? "" : undefined;
      if (stage !== undefined) {
        const { assembly, rest } = splitAssemblyKey(r.detail);
        if (!assembly) continue;
        const owner = ownerOf(assembly);
        const type = owner.types.get(rest) ?? { ms: 0, calls: 0, stages: new Map() };
        type.ms += r.total;
        type.calls += r.count ?? 0;
        if (stage) {
          const s = type.stages.get(stage) ?? { ms: 0, calls: 0 };
          s.ms += r.total;
          s.calls += r.count ?? 0;
          type.stages.set(stage, s);
        }
        owner.types.set(rest, type);
        if (perStage) {
          owner.ms += r.total;
          addPlace(owner.places, placeOf(r.t), r.total / 1000);
        }
      } else if (!perStage && r.name === BY_ASSEMBLY) {
        // The summary's per-assembly line counts the types its top ten leave out.
        const owner = ownerOf(r.detail);
        owner.ms += r.total;
        addPlace(owner.places, placeOf(r.t), r.total / 1000);
      }
    }

    return [...owners].flatMap(([assembly, { ms, places, types }]) => {
      const who = assemblyOwner(run, assembly);
      if (ms < MIN_MS || who.stock || who.tminus) return [];
      const { places: list, where } = ranked(places);
      const top = [...types].sort((a, b) => b[1].ms - a[1].ms);
      const evidence: Evidence[] = top.slice(0, EVIDENCE_TYPES).map(([name, t]) => ({
        source: "profiler",
        text: `${name}: ${Math.round(t.ms)} ms over ${t.calls} calls${t.stages.size ? ` (${[...t.stages].sort((a, b) => b[1].ms - a[1].ms).map(([s, v]) => `${s} ${Math.round(v.ms)} ms`).join(", ")})` : ""}`,
      }));
      const notes: string[] = [];
      if (!perStage) notes.push("From the summary in KSP.log, which keeps the ten costliest module types per Countdown or Hold: the .jsonl splits each type by stage.");
      notes.push("A module's time includes what it calls, other mods' code too.");
      return [
        {
          id: this.id,
          title: `Module code: ${who.name} takes ${(ms / 1000).toFixed(1)} s in its PartModules and VesselModules${list.length === 1 ? ` in ${whereText(list[0].where)}` : ""}`,
          subject: who.name,
          mods: refs(assemblyRef(run, assembly, "culprit")),
          where,
          places: list,
          cost: { kind: "measured", seconds: ms / 1000, method: `profiler: time in the stock entry points of ${assembly}'s module types (PartModule Load, Awake, OnStart, OnStartFinished; VesselModule Awake, Start, Load)` },
          evidence,
          action: `This is ${possessive(who.name)} own module code, run for every part or vessel that carries its modules, so it grows with the craft and vessels in use. Nothing to change on your side. If it matters to you, report it to ${possessive(who.name)} authors with the profiler's .jsonl: the evidence names the slowest module types.`,
          confidence: "measured",
          notes,
        },
      ];
    });
  },
};
