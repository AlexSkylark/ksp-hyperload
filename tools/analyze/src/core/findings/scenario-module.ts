// A ScenarioModule whose load takes long, in the Holds that enter a game scene.
//
// [C] ScenarioModules hold a save's per-game state (R&D, contracts, mods'
// own). On each scene entry the scene's modules are created and loaded
// (ProtoScenarioModule.Load, then the module's OnLoad: mod code), on the main
// thread, inside the Hold (docs/mechanisms.md, 6.3). The profiler times
// ScenarioRunner.AddModule per module name (aggregate "scenario.load",
// placed by checkpoint).
//
// The record names the module, not its assembly: the mod is matched by name
// against the run's "Load(Assembly)" lines, so it is a guess and the finding
// says so.

import { modOfSource } from "../mods.js";
import type { Run } from "../run.js";
import type { Evidence, Finding, Place, Rule } from "./types.js";
import { addPlace, checkpointPlace, ranked, whereText } from "./places.js";

/** A module needs at least this much load time over the session. */
const MIN_MS = 1000;

export const expensiveScenarioModule: Rule = {
  id: "expensive-scenario-module",
  needs: "profiler",
  detects: "expensive ScenarioModules: per-module load time in each Hold",
  run(run: Run): Finding[] {
    const placeOf = checkpointPlace(run);
    const byModule = new Map<string, { ms: number; loads: number; places: Map<string, Place> }>();
    for (const r of run.records.filter((r) => r.kind === "aggregate" && r.name === "scenario.load" && !String(r.detail).startsWith("(other"))) {
      const e = byModule.get(r.detail) ?? { ms: 0, loads: 0, places: new Map() };
      e.ms += r.total;
      e.loads += r.count ?? 0;
      addPlace(e.places, placeOf(r.t), r.total / 1000);
      byModule.set(r.detail, e);
    }

    return [...byModule].flatMap(([module, { ms, loads, places }]) => {
      if (ms < MIN_MS) return [];
      const mod = modOfSource(run, module);
      const { places: list, where } = ranked(places);
      const evidence: Evidence[] = list.map((p) => ({ source: "profiler", text: `scenario.load ${module}: ${Math.round(p.seconds * 1000)} ms in ${whereText(p.where)}` }));
      const notes = [`${loads} load${loads === 1 ? "" : "s"} over the session: the module loads again on every scene entry that uses it.`];
      if (mod) notes.push(`The mod is matched by the module's name (${module}) against the installed assemblies: check that it is ${mod.name}.`);
      else notes.push("No installed assembly matches the module's name: it may be stock, or a mod whose assembly is named differently.");
      return [
        {
          id: this.id,
          title: `Expensive ScenarioModule: ${module}${mod ? ` (likely ${mod.name})` : ""}${list.length === 1 ? ` in ${whereText(list[0].where)}` : ""}`,
          subject: mod?.name ?? module,
          where,
          places: list,
          cost: { kind: "measured", seconds: ms / 1000, method: `profiler: total time loading ${module} (ScenarioRunner.AddModule)` },
          evidence,
          action: `Its cost usually grows with the save's own data, so a long career or many vessels make it larger. If it matters to you, report it to the authors of ${mod?.name ?? `the mod that adds ${module}`} with the profiler's .jsonl.`,
          confidence: "measured",
          notes,
        },
      ];
    });
  },
};
