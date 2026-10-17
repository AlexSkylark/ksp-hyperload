// Per-mod totals of a profiler family timed per "<assembly>/<key>" with self
// time (coroutine steps, Unity messages): the calls no other timed call
// encloses add up per assembly, the enclosed ones apart, and from the summary
// the per-assembly sums replace the per-key ones (the summary keeps only the
// ten costliest keys per block).

import { splitAssemblyKey } from "../mods.js";
import type { Run } from "../run.js";
import type { Place } from "./types.js";
import { addPlace, checkpointPlace } from "./places.js";

export interface ModCode {
  /** Time in calls no other timed call encloses, ms. */
  ms: number;
  /** Time in calls inside other timed code, ms: never added. */
  withinMs: number;
  places: Map<string, Place>;
  /** Per key (the part after "<assembly>/"). */
  keys: Map<string, { ms: number; count: number }>;
}

export interface ModCodeFamilies {
  /** Calls no other timed call encloses. */
  own: string;
  /** Calls inside other timed code. */
  within: string;
  /** The summary's per-assembly sums. */
  byAssembly: string;
}

/** Per assembly; `fromSummary` when the per-assembly sums came from KSP.log's summary. */
export function modCode(run: Run, families: ModCodeFamilies): { owners: Map<string, ModCode>; fromSummary: boolean } {
  const placeOf = checkpointPlace(run);
  const aggregates = run.records.filter((r) => r.kind === "aggregate" && !String(r.detail).startsWith("(other"));
  const fromSummary = aggregates.some((r) => r.name === families.byAssembly);
  const owners = new Map<string, ModCode>();
  const ownerOf = (assembly: string) => {
    const o = owners.get(assembly) ?? { ms: 0, withinMs: 0, places: new Map(), keys: new Map() };
    owners.set(assembly, o);
    return o;
  };

  for (const r of aggregates) {
    if (r.name === families.byAssembly) {
      const owner = ownerOf(r.detail);
      owner.ms += r.total;
      addPlace(owner.places, placeOf(r.t), r.total / 1000);
      continue;
    }
    if (r.name !== families.own && r.name !== families.within) continue;
    const { assembly, rest } = splitAssemblyKey(r.detail);
    if (!assembly) continue;
    const owner = ownerOf(assembly);
    if (r.name === families.within) {
      owner.withinMs += r.total;
      continue;
    }
    const key = owner.keys.get(rest) ?? { ms: 0, count: 0 };
    key.ms += r.total;
    key.count += r.count ?? 0;
    owner.keys.set(rest, key);
    if (!fromSummary) {
      owner.ms += r.total;
      addPlace(owner.places, placeOf(r.t), r.total / 1000);
    }
  }
  return { owners, fromSummary };
}
