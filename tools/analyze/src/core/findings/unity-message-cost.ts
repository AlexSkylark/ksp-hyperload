// A mod whose per-frame code (Unity messages) takes long while the game loads.
//
// [C] Unity calls a behaviour's Update, LateUpdate, FixedUpdate and OnGUI
// itself, every frame; PartModule, VesselModule and ScenarioModule declare
// none of them, so no stock entry point attributes the work. The profiler
// (group unityMessageHooks) patches each mod-declared message when it first
// sees an instance of the type, and times it only during the Countdown and
// the Holds, by "<assembly>/<declaring type>.<message>" (docs/m6-web-plan.md,
// "Unity messages: assessment and proposal"). A call inside another timed call
// is recorded apart as unity.message.within and never added here; a call
// records only its own time. The .jsonl has every method; the summary
// (format 6) keeps the ten costliest per block and sums them per assembly.
//
// Stock- and engine-declared messages are never timed.

import { assemblyOwner, assemblyRef } from "../mods.js";
import type { Run } from "../run.js";
import type { Evidence, Finding, Rule } from "./types.js";
import { possessive, ranked, refs, whereText } from "./places.js";
import { modCode } from "./per-mod.js";

/** A mod needs at least this much per-frame time while loading (design, "Thresholds": 1 s). */
const MIN_MS = 1000;
/** Methods shown per mod. */
const EVIDENCE_METHODS = 5;

export const expensiveUnityMessage: Rule = {
  id: "expensive-unity-message",
  needs: "profiler",
  detects: "mods whose per-frame code (Update and similar) takes long while the game loads (Unity message timing)",
  run(run: Run): Finding[] {
    const { owners, fromSummary } = modCode(run, { own: "unity.message", within: "unity.message.within", byAssembly: "unity.message.byAssembly" });
    return [...owners].flatMap(([assembly, { ms, withinMs, places, keys }]) => {
      const who = assemblyOwner(run, assembly);
      if (ms < MIN_MS || who.stock || who.tminus) return [];
      const { places: list, where } = ranked(places);
      const top = [...keys].sort((a, b) => b[1].ms - a[1].ms);
      const evidence: Evidence[] = top.slice(0, EVIDENCE_METHODS).map(([name, m]) => ({
        source: "profiler",
        text: `${name}: ${Math.round(m.ms)} ms over ${m.count} call${m.count === 1 ? "" : "s"}`,
      }));
      const notes: string[] = [];
      if (fromSummary) notes.push("From the summary in KSP.log, which keeps the ten costliest methods per Countdown or Hold.");
      if (withinMs >= 1) notes.push(`Not counted: ${Math.round(withinMs)} ms of these calls ran inside other timed code, which already counts them.`);
      notes.push("Only time while the game loads (the Countdown and the Holds) is counted. A call's time includes what it calls, other mods' code too.");
      return [
        {
          id: this.id,
          title: `Per-frame code: ${who.name} takes ${(ms / 1000).toFixed(1)} s in its Update and similar methods${list.length === 1 ? ` in ${whereText(list[0].where)}` : " while loading"}`,
          subject: who.name,
          mods: refs(assemblyRef(run, assembly, "culprit")),
          where,
          places: list,
          cost: { kind: "measured", seconds: ms / 1000, method: `profiler: time in ${assembly}'s Update, LateUpdate, FixedUpdate and OnGUI while loading, calls inside other timed code left out` },
          evidence,
          action: `This is ${possessive(who.name)} own code, run every frame. Nothing to change on your side. If it matters to you, report it to ${possessive(who.name)} authors with the profiler's .jsonl: the evidence names the slowest methods.`,
          cause: `${possessive(who.name)} per-frame code`,
          remedy: "report",
          confidence: "measured",
          notes,
        },
      ];
    });
  },
};
