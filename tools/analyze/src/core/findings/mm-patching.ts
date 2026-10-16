// Whose ModuleManager patches the main thread waited for, on a startup that
// patched from scratch.
//
// [C] MM stamps each line of its log when the patching thread creates it
// (LogMessage), whatever thread writes it later. Each pass logs "{pass} pass"
// before its patches, and each patch logs "Applying update|copy|delete {patch}
// to {node}" (or "Looping on") before it changes that node, so the time from
// one of these lines to the next is that patch's work, with its warnings and
// errors in between (docs/mechanisms.md, area 1). The patch's URL starts with
// the GameData folder that ships it. The main thread waits only for the
// patching left when the loading screen reaches PostPatchLoader ("Waited"); the
// rest ran alongside asset loading and cost the Countdown nothing. So each
// folder is charged only its time inside the wait.
//
// The time is a guess: a patch that matches no node logs no line, so its scan
// goes to the line before it, and a patch's scan up to its first match goes to
// the patch before it. It is also part of the wait the cache findings already
// charge (within): fixing the cache removes all of it.

import { DECIMAL, decimal, type LogLine } from "../log.js";
import { folderOfUrl, folderRef } from "../mods.js";
import type { Run } from "../run.js";
import type { Evidence, Finding, Rule } from "./types.js";
import { cacheNotSavedLine } from "./mm-cache.js";
import { possessive } from "./places.js";

const MIN_SECONDS = 1;
const WAITED = new RegExp(String.raw`^\[ModuleManager\] Waited (${DECIMAL})s for patching to finish`);
const APPLYING = /^(?:Applying (?:update|copy|delete)|Looping on) (\S+) to /;
const PASS = / pass$/;
/** Lines a patch logs while it is applied: its warnings, errors and exceptions. */
const PATCH_LEVELS = new Set(["WRN", "ERR", "EXC"]);

interface Owner {
  seconds: number;
  lines: number;
  first: LogLine;
  last: LogLine;
}

export const mmPatchingByMod: Rule = {
  id: "mm-patching-by-mod",
  needs: "log",
  detects: "ModuleManager's patching time per mod, inside the wait",
  run(run: Run): Finding[] {
    // This startup's lines only: a cache startup's patch log comes from an earlier one.
    const dump = run.mmDumps[0];
    if (!dump?.complete || dump.lines.some((l) => l.text === "useCache = True")) return [];
    const waited = run.log.find((l) => WAITED.test(l.text));
    if (!waited) return [];
    const wait = decimal(WAITED.exec(waited.text)![1]);
    const from = waited.t - wait;
    const to = waited.t;

    const owners = new Map<string, Owner>();
    let owner: string | undefined;
    const lines = dump.lines;
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      const applying = APPLYING.exec(l.text);
      if (applying) owner = folderOfUrl(applying[1]);
      else if (PASS.test(l.text) || !PATCH_LEVELS.has(l.level)) owner = undefined;
      const next = lines[i + 1];
      if (!owner || !next) continue;
      const seconds = Math.min(next.t, to) - Math.max(l.t, from);
      if (seconds <= 0) continue;
      const o = owners.get(owner) ?? { seconds: 0, lines: 0, first: l, last: l };
      o.seconds += seconds;
      if (applying) o.lines++;
      o.last = l;
      owners.set(owner, o);
    }

    // The finding whose cost is the wait: the cache not saved, or patching from scratch.
    const within = cacheNotSavedLine(lines) ? "mm-cache-not-saved" : "mm-cold-startup";
    const action =
      within === "mm-cache-not-saved"
        ? "None for this mod: fixing ModuleManager's cache (see the finding on it) removes this time, because a startup with a saved cache does not patch."
        : "None needed: ModuleManager pays this only on startups that patch from scratch; once its cache is saved, the next startup loads it unless a mod or config file changes again.";
    const out: Finding[] = [];
    for (const [folder, o] of owners) {
      const ref = folderRef(folder, "culprit");
      if (!ref || o.seconds < MIN_SECONDS) continue;
      const evidence: Evidence[] = [o.first, ...(o.last !== o.first ? [o.last] : []), waited].map((l) => ({ source: "log", line: l.n, text: l.text }));
      out.push({
        id: this.id,
        title: `ModuleManager's wait included ${possessive(folder)} patches`,
        subject: folder,
        mods: [ref],
        where: { phase: "countdown" },
        cost: {
          kind: "estimated",
          seconds: o.seconds,
          method: `time from each of its ${o.lines} patch lines in ModuleManager's log to the next line, inside the ${wait.toFixed(1)} s the main thread waited for patching; a patch that matches nothing logs no line, so its time goes to the line before it`,
        },
        evidence,
        action,
        cause: `${possessive(folder)} ModuleManager patches`,
        remedy: "none",
        confidence: "heuristic",
        informational: true,
        within,
      });
    }
    return out;
  },
};
