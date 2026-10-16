// Mods' ModuleManagerPostLoad callbacks that take long.
//
// [C] After patching, ModuleManager calls every public static
// ModuleManagerPostLoad() in every loaded assembly, then the public instance
// one on every live MonoBehaviour, all on the main thread
// (PostPatchLoader.Run, docs/mechanisms.md, 1.5). Before each call it logs
// "Calling {assembly}.{type}.ModuleManagerPostLoad()" (static) or
// "Calling {type}.ModuleManagerPostLoad()" (instance). Nothing marks a call's
// end, so a call lasts until MM's next line: an upper bound that also holds
// MM's type scan of the assemblies that follow. The time from "Running post
// patch callbacks" to the first call (the callbacks mods register, KSPCF's
// patching among them) has no owner in the log and is left out.

import type { LogLine } from "../log.js";
import { assemblyOwner, modOfSource } from "../mods.js";
import type { Run } from "../run.js";
import type { Evidence, Finding, Rule } from "./types.js";

const MIN_SECONDS = 1;
const CALLING = /^\[ModuleManager\] Calling (.+)\.ModuleManagerPostLoad\(\)$/;

export const mmPostLoadCallback: Rule = {
  id: "mm-post-load-callback",
  needs: "log",
  detects: "mods' ModuleManagerPostLoad callbacks that take long",
  run(run: Run): Finding[] {
    // This startup's callbacks: later ones come from database reloads in MM's menu.
    const start = run.log.findIndex((l) => l.text === "[ModuleManager] Running post patch callbacks");
    if (start < 0) return [];
    const mmLines = run.log.slice(start + 1).filter((l) => l.text.startsWith("[ModuleManager] "));
    const end = mmLines.findIndex((l) => l.text.startsWith("[ModuleManager] Post patch ran in"));
    const calls = (end < 0 ? mmLines : mmLines.slice(0, end + 1)).flatMap((l, i, all) => {
      const m = CALLING.exec(l.text);
      const next = all[i + 1];
      return m && next ? [{ line: l, next, name: m[1], seconds: next.t - l.t }] : [];
    });

    const owners = new Map<string, { name: string; guessed: boolean; seconds: number; lines: LogLine[]; calls: string[] }>();
    for (const c of calls) {
      // Static form: "<assembly>.<type>", and a type name has no dot. Instance form: "<type>".
      const dot = c.name.lastIndexOf(".");
      let name: string;
      let guessed = false;
      if (dot > 0) {
        const owner = assemblyOwner(run, c.name.slice(0, dot));
        if (owner.stock || owner.tminus) continue;
        name = owner.name;
      } else {
        const mod = modOfSource(run, c.name);
        name = mod?.name ?? c.name;
        guessed = mod !== undefined;
      }
      const o = owners.get(name) ?? { name, guessed, seconds: 0, lines: [], calls: [] };
      o.guessed ||= guessed;
      o.seconds += c.seconds;
      o.lines.push(...[c.line, c.next].filter((l) => !o.lines.includes(l)));
      o.calls.push(`${c.name} ${c.seconds.toFixed(2)} s`);
      owners.set(name, o);
    }

    return [...owners.values()]
      .filter((o) => o.seconds >= MIN_SECONDS)
      .map((o) => {
        const evidence: Evidence[] = o.lines.map((l) => ({ source: "log", line: l.n, text: l.text }));
        return {
          id: this.id,
          title: `${o.name} took ${o.seconds.toFixed(1)} s in its ModuleManagerPostLoad callback`,
          subject: o.name,
          where: { phase: "countdown" },
          cost: {
            kind: "estimated",
            seconds: o.seconds,
            method: "from each \"Calling ...ModuleManagerPostLoad()\" line to ModuleManager's next line: an upper bound that includes MM's scan for the next callback",
          },
          evidence,
          action: `This is ${o.name}'s own work after patching, on the main thread. If the cost matters to you, report it to its authors, and decide whether the mod is worth its cost.`,
          confidence: o.guessed ? "heuristic" : "measured",
          notes: [
            ...(o.calls.length > 1 ? [`By callback: ${o.calls.join(", ")}.`] : []),
            ...(o.guessed ? [`A callback names only its type; ${o.name} is the installed mod whose name matches it.`] : []),
          ],
        } satisfies Finding;
      });
  },
};
