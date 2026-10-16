// The time Harmony spends applying a mod's patches.
//
// [C] Each Harmony.Patch or Unpatch call rebuilds the target method: it reads
// the method's IL, merges every patch on it and compiles a new version, on the
// calling thread, mostly in the Countdown (docs/mechanisms.md, 7). The profiler
// times PatchFunctions.UpdateWrapper per owner, "<assembly>/<Harmony id>"
// (docs/m5-profiler-plan.md, "Step 4a").
//
// Informational, with a neutral action: the time is the price of the mod's
// patches, which are what the mod does (fixes, optimizations, features). It is
// no fault and the player has nothing to change. T-Minus' own rebuilds are left
// out.

import { assemblyOwner, assemblyRef, splitAssemblyKey } from "../mods.js";
import type { Run } from "../run.js";
import type { Evidence, Finding, Place, Rule } from "./types.js";
import { addPlace, checkpointPlace, possessive, ranked, refs, whereText } from "./places.js";

/** A mod needs at least this much patching time over the session. Provisional (step 9). */
const MIN_MS = 1000;

export const harmonyPatchingCost: Rule = {
  id: "harmony-patching-cost",
  needs: "profiler",
  detects: "mods whose Harmony patches take long to apply",
  run(run: Run): Finding[] {
    const placeOf = checkpointPlace(run);
    const byAssembly = new Map<string, { ms: number; places: Map<string, Place>; owners: Map<string, { ms: number; rebuilds: number; unpatches: number }> }>();
    for (const r of run.records) {
      if (r.kind !== "aggregate" || (r.name !== "harmony.patch" && r.name !== "harmony.unpatch") || String(r.detail).startsWith("(other")) continue;
      const { assembly, rest } = splitAssemblyKey(r.detail);
      const e = byAssembly.get(assembly ?? "unknown") ?? { ms: 0, places: new Map(), owners: new Map() };
      e.ms += r.total;
      addPlace(e.places, placeOf(r.t), r.total / 1000);
      const o = e.owners.get(rest) ?? { ms: 0, rebuilds: 0, unpatches: 0 };
      o.ms += r.total;
      if (r.name === "harmony.patch") o.rebuilds += r.count ?? 0;
      else o.unpatches += r.count ?? 0;
      e.owners.set(rest, o);
      byAssembly.set(assembly ?? "unknown", e);
    }
    const bracketsOn = run.records.some((r) => r.kind === "counter" && r.name === "harmony.call.bracketed");

    return [...byAssembly].flatMap(([assembly, { ms, places, owners }]) => {
      const who = assemblyOwner(run, assembly);
      if (ms < MIN_MS || who.tminus) return [];
      const { places: list, where } = ranked(places);
      const evidence: Evidence[] = [...owners]
        .sort((a, b) => b[1].ms - a[1].ms)
        .map(([id, o]) => ({
          source: "profiler",
          text: `Harmony id ${id}: ${Math.round(o.ms)} ms, ${o.rebuilds} patch call${o.rebuilds === 1 ? "" : "s"}${o.unpatches ? `, ${o.unpatches} unpatch call${o.unpatches === 1 ? "" : "s"}` : ""}`,
        }));
      const notes: string[] = [];
      if (bracketsOn)
        notes.push("T-Minus' per-call brackets (harmonyCallHooks) were on: rebuilds of methods they bracket also compile T-Minus' own patches, so this is a little above a normal run.");
      return [
        {
          id: this.id,
          title: `Harmony patching: ${possessive(who.name)} patches take ${(ms / 1000).toFixed(1)} s to apply${list.length === 1 ? ` in ${whereText(list[0].where)}` : ""}`,
          subject: who.name,
          mods: refs(assembly === "unknown" ? undefined : assemblyRef(run, assembly, "culprit")),
          where,
          places: list,
          cost: { kind: "measured", seconds: ms / 1000, method: "profiler: time in Harmony's rebuild of each method the owner patches or unpatches (PatchFunctions.UpdateWrapper)" },
          evidence,
          action: `Harmony compiles a new version of every method ${who.name} patches. This is the price of what they do, not a fault: nothing to change on your side.`,
          cause: `${possessive(who.name)} Harmony patching`,
          remedy: "none",
          confidence: "measured",
          informational: true,
          notes,
        },
      ];
    });
  },
};
