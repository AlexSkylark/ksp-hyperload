// A ScenarioModule whose load takes long, in the Holds that enter a game scene.
//
// [C] ScenarioModules hold a save's per-game state (R&D, contracts, mods'
// own). On each scene entry the scene's modules are created and loaded
// (ProtoScenarioModule.Load, then the module's OnLoad: mod code), on the main
// thread, inside the Hold (docs/mechanisms.md, 6.3). The profiler times
// ScenarioRunner.AddModule per module (aggregate "scenario.load", placed by
// checkpoint).
//
// From summary format 3 the key is the module's type, "<assembly>/<type>", so
// the mod is known. Older records name the module only: the mod is then matched
// by name against the run's "Load(Assembly)" lines, a guess the finding states.

import { isStockAssembly, modOfAssembly, modOfSource, modRef, splitAssemblyKey, type Mod } from "../mods.js";
import type { Run } from "../run.js";
import type { Evidence, Finding, Place, Rule } from "./types.js";
import { addPlace, checkpointPlace, ranked, whereText } from "./places.js";

/** A module needs at least this much load time over the session. */
const MIN_MS = 1000;

/** Who the module belongs to, and how sure that is. */
function ownerOf(run: Run, key: string): { module: string; mod?: Mod; stock: boolean; guessed: boolean; assembly?: string } {
  const { assembly, rest } = splitAssemblyKey(key);
  if (assembly === undefined) return { module: key, mod: modOfSource(run, key), stock: false, guessed: true };
  return { module: rest, mod: modOfAssembly(run, assembly), stock: isStockAssembly(assembly), guessed: false, assembly };
}

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

    return [...byModule].flatMap(([key, { ms, loads, places }]) => {
      if (ms < MIN_MS) return [];
      const { module, mod, stock, guessed, assembly } = ownerOf(run, key);
      const { places: list, where } = ranked(places);
      const evidence: Evidence[] = list.map((p) => ({ source: "profiler", text: `scenario.load ${key}: ${Math.round(p.seconds * 1000)} ms in ${whereText(p.where)}` }));
      const notes = [`${loads} load${loads === 1 ? "" : "s"} over the session: the module loads again on every scene entry that uses it.`];
      if (guessed && mod) notes.push(`The mod is matched by the module's name (${module}) against the installed assemblies: check that it is ${mod.name}.`);
      else if (guessed) notes.push("No installed assembly matches the module's name: it may be stock, or a mod whose assembly is named differently.");
      const owner = stock ? "stock KSP" : mod?.name ?? assembly;
      const shown = stock ? " (stock)" : mod ? ` (${guessed ? "likely " : ""}${mod.name})` : assembly ? ` (${assembly})` : "";
      return [
        {
          id: this.id,
          title: `Expensive ScenarioModule: ${module}${shown}${list.length === 1 ? ` in ${whereText(list[0].where)}` : ""}`,
          subject: owner ?? module,
          mods: stock ? undefined : mod ? [modRef(mod, guessed ? "candidate" : "culprit")] : assembly ? [{ name: assembly, role: "culprit" }] : undefined,
          where,
          places: list,
          cost: { kind: "measured", seconds: ms / 1000, method: `profiler: total time loading ${module} (ScenarioRunner.AddModule)` },
          evidence,
          action: stock
            ? `${module} is stock KSP: its cost grows with the save's own data (a long career, many vessels or contracts). Nothing to change in the mods.`
            : `Its cost usually grows with the save's own data, so a long career or many vessels make it larger. If it matters to you, report it to the authors of ${owner ?? `the mod that adds ${module}`} with the profiler's .jsonl.`,
          confidence: "measured",
          notes,
        },
      ];
    });
  },
};
