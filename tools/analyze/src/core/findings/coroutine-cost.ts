// A mod whose coroutines take long to run.
//
// [C] Unity runs a coroutine one step (MoveNext) at a time from its own loop,
// so no stock entry point attributes the work. The profiler (group
// coroutineHooks, on by default) patches each enumerator type's MoveNext when its first
// coroutine starts and times every step, by "<assembly>/<type>"
// (docs/m6-web-plan.md, "Order decided", item 2). A step inside another timed
// call (a coroutine's first step runs inside StartCoroutine, often inside a
// timed Start or OnStart) is recorded apart as coroutine.step.within: that
// time is already in the enclosing call, so it is never added here. A step
// records only its own time: timed calls inside it keep theirs. Loader
// coroutines (started on a LoadingSystem, and the ones they yield) are
// coroutine.step.loading and never read here: they run other mods' work, which
// the Countdown's stage rules already split per mod. The .jsonl
// has every type; the summary (format 5) keeps the ten costliest per block and
// sums them per assembly.
//
// Stock coroutines are left out, as stock modules are: their cost is the game's.

import { assemblyOwner, assemblyRef } from "../mods.js";
import type { Run } from "../run.js";
import type { Evidence, Finding, Rule } from "./types.js";
import { possessive, ranked, refs, whereText } from "./places.js";
import { modCode } from "./per-mod.js";

/** A mod needs at least this much coroutine time over the session (design, "Thresholds": 1 s). */
const MIN_MS = 1000;
/** Enumerator types shown per mod. */
const EVIDENCE_TYPES = 5;

/** "Outer+<LoadAll>d__12" → "Outer.LoadAll": the method the compiler made the iterator from. */
export function coroutineName(type: string): string {
  const m = /^(.*)\+<([^>]+)>d__\d+$/.exec(type);
  return m ? `${m[1]}.${m[2]}` : type;
}

export const expensiveCoroutine: Rule = {
  id: "expensive-coroutine",
  needs: "profiler",
  detects: "mods whose coroutines take long to run (coroutine timing)",
  run(run: Run): Finding[] {
    const { owners, fromSummary } = modCode(run, { own: "coroutine.step", within: "coroutine.step.within", byAssembly: "coroutine.byAssembly" });
    return [...owners].flatMap(([assembly, { ms, withinMs, places, keys: types }]) => {
      const who = assemblyOwner(run, assembly);
      if (ms < MIN_MS || who.stock || who.tminus) return [];
      const { places: list, where } = ranked(places);
      const top = [...types].sort((a, b) => b[1].ms - a[1].ms);
      const evidence: Evidence[] = top.slice(0, EVIDENCE_TYPES).map(([name, t]) => ({
        source: "profiler",
        text: `${coroutineName(name)}: ${Math.round(t.ms)} ms over ${t.count} step${t.count === 1 ? "" : "s"}`,
      }));
      const notes: string[] = [];
      if (fromSummary) notes.push("From the summary in KSP.log, which keeps the ten costliest coroutine types per Countdown or Hold.");
      if (withinMs >= 1) notes.push(`Not counted: ${Math.round(withinMs)} ms of its steps ran inside other timed code (its own Start or OnStart, an event), which already counts them.`);
      notes.push("A step's time includes what it calls, other mods' code too.");
      return [
        {
          id: this.id,
          title: `Coroutines: ${who.name} takes ${(ms / 1000).toFixed(1)} s in its coroutines${list.length === 1 ? ` in ${whereText(list[0].where)}` : ""}`,
          subject: who.name,
          mods: refs(assemblyRef(run, assembly, "culprit")),
          where,
          places: list,
          cost: { kind: "measured", seconds: ms / 1000, method: `profiler: time in every step of ${assembly}'s coroutines, steps inside other timed code left out` },
          evidence,
          action: `This is ${possessive(who.name)} own code, run in coroutines over one or more frames. Nothing to change on your side. If it matters to you, report it to ${possessive(who.name)} authors with the profiler's .jsonl: the evidence names the slowest coroutines.`,
          cause: `${possessive(who.name)} coroutines`,
          remedy: "report",
          confidence: "measured",
          notes,
        },
      ];
    });
  },
};
