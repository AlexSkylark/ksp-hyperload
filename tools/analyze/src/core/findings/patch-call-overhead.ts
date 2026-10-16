// A stock method whose other mods' patches add much time to its calls.
//
// [C] With the opt-in group harmonyCallHooks, the profiler brackets all of a
// method's patches from other owners: the time between the outer and the inner
// bracket is what the patches add to each call (docs/m5-profiler-plan.md,
// "Step 4b"). Totals are raw; the brackets' own cost per call is calibrated
// once and subtracted here, so the net time is inferred from two measurements.
// The overhead cannot be split between owners when several patch the method:
// the bracket mark lists them all. Methods with other finalizers or
// pass-through postfixes run part of their patches outside the window
// ("partial"): a lower bound.

import { assemblyOwner, splitAssemblyKey } from "../mods.js";
import type { Run } from "../run.js";
import type { Evidence, Finding, Place, Rule } from "./types.js";
import { addPlace, checkpointPlace, possessive, ranked, whereText } from "./places.js";

/** A method needs at least this much net patch time over the session. Provisional (step 9). */
const MIN_MS = 1000;

/** The owners of each bracketed method, as owner keys "<assembly>/<id>" when known. */
function ownersByMethod(run: Run): Map<string, string[]> {
  // Older marks name owners by Harmony id only: the patching records give their assembly.
  const assemblyOfId = new Map<string, string>();
  for (const r of run.records) {
    if (r.kind !== "aggregate" || r.name !== "harmony.patch") continue;
    const { assembly, rest } = splitAssemblyKey(r.detail);
    if (assembly) assemblyOfId.set(rest, assembly);
  }
  const keyOf = (owner: string) => (splitAssemblyKey(owner).assembly || !assemblyOfId.has(owner) ? owner : `${assemblyOfId.get(owner)}/${owner}`);

  const owners = new Map<string, string[]>();
  for (const r of run.records) {
    if (r.kind !== "mark" || r.name !== "harmony.call.bracket" || typeof r.detail !== "string") continue;
    const colon = r.detail.lastIndexOf(": ");
    if (colon > 0) owners.set(r.detail.slice(0, colon), r.detail.slice(colon + 2).split(",").filter(Boolean).map(keyOf));
  }
  return owners;
}

const latest = (run: Run, name: string) => run.records.filter((r) => r.kind === "counter" && r.name === name).at(-1);

export const patchCallOverhead: Rule = {
  id: "patch-call-overhead",
  needs: "profiler",
  detects: "methods whose other mods' patches add much time to their calls (opt-in per-call brackets)",
  run(run: Run): Finding[] {
    const calibration = latest(run, "harmony.call.calibration.patches")?.value ?? 0;
    const placeOf = checkpointPlace(run);
    const methods = new Map<string, { ms: number; calls: number; body: number; places: Map<string, Place> }>();
    for (const r of run.records) {
      if (r.kind !== "aggregate" || (r.name !== "harmony.call.patches" && r.name !== "harmony.call.body") || String(r.detail).startsWith("(other")) continue;
      const e = methods.get(r.detail) ?? { ms: 0, calls: 0, body: 0, places: new Map() };
      if (r.name === "harmony.call.body") e.body += r.total;
      else {
        const net = Math.max(0, r.total - ((r.count ?? 0) * calibration) / 1e6);
        e.ms += net;
        e.calls += r.count ?? 0;
        addPlace(e.places, placeOf(r.t), net / 1000);
      }
      methods.set(r.detail, e);
    }
    if (!methods.size) return [];
    const owners = ownersByMethod(run);
    const partial = new Set(String(latest(run, "harmony.call.partial")?.detail ?? "").split(",").filter(Boolean));

    return [...methods].flatMap(([key, { ms, calls, body, places }]) => {
      if (ms < MIN_MS) return [];
      const method = splitAssemblyKey(key).rest;
      const who = [...new Set((owners.get(key) ?? []).flatMap((o) => {
        const { assembly, rest } = splitAssemblyKey(o);
        const owner = assembly ? assemblyOwner(run, assembly) : undefined;
        return owner?.tminus ? [] : [owner?.name ?? rest];
      }))];
      const named = who.length ? who.join(", ") : "other mods";
      const { places: list, where } = ranked(places);
      const evidence: Evidence[] = [
        { source: "profiler", text: `${key}: ${calls} calls, ${Math.round(ms)} ms in its patches (net), ${Math.round(body)} ms in its own body` },
        ...(owners.has(key) ? [{ source: "profiler" as const, text: `patched by ${owners.get(key)!.join(", ")}` }] : []),
      ];
      const notes = [
        `${(ms * 1e6 / Math.max(1, calls)).toFixed(0)} ns per call, after subtracting the brackets' own ${calibration.toFixed(1)} ns.`,
      ];
      if (who.length > 1) notes.push("Several mods patch this method: the time cannot be split between them.");
      if (partial.has(key)) notes.push("Some of its patches (finalizers, or postfixes that return a value) run outside the measured window: the real overhead is higher.");
      return [
        {
          id: this.id,
          title: `Patch overhead: ${named} add${who.length === 1 ? "s" : ""} ${(ms / 1000).toFixed(1)} s to ${method} (${calls} calls)`,
          subject: who.length ? who.join(", ") : method,
          where,
          places: list,
          cost: {
            kind: "measured",
            seconds: ms / 1000,
            method: "profiler (opt-in per-call brackets): time inside other mods' patches of the method, minus the brackets' calibrated cost per call",
          },
          evidence,
          action: `${who.length ? possessive(named) : "Other mods'"} patch${who.length === 1 ? "" : "es"} on ${method} run on every call, and it is called often. If it matters to you, report it to the authors with the profiler's .jsonl: the cost per call is in the notes.`,
          confidence: "measured",
          notes,
        },
      ];
    });
  },
};
