// ModuleManager patched from scratch, with the reason its cache was not used.
//
// [C] On every startup MM hashes every config file and the loaded DLLs'
// paths, and uses its cache only when the hashes, its own version, KSP's
// version and the cache files all match (MMPatchLoader.IsCacheUpToDate,
// docs/mechanisms.md, 1.2). Which check failed shows in its log, which reaches
// KSP.log only as the dump. After a change, one cold startup is expected and
// the finding is informational; with no TechTree node after patching, MM
// writes no tech-tree file and every startup will be cold. When the cache was
// not saved, mm-cache-not-saved reports the startup instead.

import { DECIMAL, decimal, type LogLine } from "../log.js";
import { folderOfUrl, folderRef } from "../mods.js";
import type { Run } from "../run.js";
import type { Evidence, Finding, Rule } from "./types.js";
import { cacheNotSavedLine } from "./mm-cache.js";
import { refs } from "./places.js";

const MIN_SECONDS = 1;
const WAITED = new RegExp(String.raw`^\[ModuleManager\] Waited (${DECIMAL})s for patching to finish`);
const SHA = /^\s*SHA = (\S+)/;
const CACHE_SHA = /^Cache SHA = (\S+)/;
const CHANGE = /^(Changed|Added|Deleted)\s*: (.+)$/;
const NO_TECH_TREE = "No TechTree node found. No custom TechTree will be saved";

/** Why the cache was not used, from the lines present (docs/mechanisms.md, 1.2 table). */
function reason(lines: LogLine[]): { text: string; evidence: LogLine[]; files: string[] } | undefined {
  const at = (p: (l: LogLine) => boolean) => lines.find(p);
  const threw = at((l) => l.level === "EXC" && l.text.startsWith("Exception in IsCacheUpToDate"));
  if (threw) return { text: "its cache check threw an exception", evidence: [threw], files: [] };
  const changes = at((l) => l.text.trim() === "Changes :");
  if (changes) {
    const files = (changes.more ?? []).flatMap((m) => {
      const c = CHANGE.exec(m.text.trim());
      return c ? [`${c[1]}: ${c[2]}`] : [];
    });
    const count = (kind: string) => files.filter((f) => f.startsWith(kind)).length;
    const parts = [["Changed", "changed"], ["Added", "added"], ["Deleted", "deleted"]].flatMap(([k, word]) => (count(k) ? [`${count(k)} ${word}`] : []));
    return { text: `config files changed (${parts.join(", ") || "no file listed"})`, evidence: [changes], files };
  }
  const useCache = at((l) => l.text.startsWith("useCache = "));
  if (!useCache) return { text: "there was no usable cache from an earlier startup (the first startup, or the earlier one did not save it)", evidence: [], files: [] };
  const sha = at((l) => SHA.test(l.text));
  const cacheSha = at((l) => CACHE_SHA.test(l.text));
  if (sha && cacheSha && SHA.exec(sha.text)![1] !== CACHE_SHA.exec(cacheSha.text)![1])
    return { text: "the set of DLLs, their paths or ModuleManager's mod list changed", evidence: [cacheSha, sha], files: [] };
  return { text: "ModuleManager or KSP was updated, or a cache file is missing (KSP.log does not tell which)", evidence: cacheSha ? [cacheSha] : [], files: [] };
}

export const mmColdStartup: Rule = {
  id: "mm-cold-startup",
  needs: "log",
  detects: "ModuleManager patching from scratch, and why",
  run(run: Run): Finding[] {
    const dump = run.mmDumps[0];
    if (!dump?.complete || cacheNotSavedLine(dump.lines)) return [];
    const lines = dump.lines;
    // Lines of this MM version's cache check; without them the rule names nothing.
    const generated = lines.find((l) => l.text.startsWith("SHA generated in"));
    if (!generated || lines.some((l) => l.text === "useCache = True")) return [];
    const why = reason(lines);
    if (!why) return [];

    const noTechTree = lines.find((l) => l.text.startsWith(NO_TECH_TREE));
    const waited = run.log.find((l) => WAITED.test(l.text));
    const seconds = waited && decimal(WAITED.exec(waited.text)![1]);
    if (!noTechTree && (seconds ?? 0) < MIN_SECONDS) return [];

    const folders = [...new Set(why.files.map((f) => folderOfUrl(f.slice(f.indexOf(": ") + 2))))];
    const evidence: Evidence[] = [generated, ...why.evidence, ...(noTechTree ? [noTechTree] : [])].map((l) => ({ source: "log", line: l.n, text: l.text }));
    evidence.push(...why.files.slice(0, 10).map((f) => ({ source: "log" as const, text: f })));
    if (waited) evidence.push({ source: "log", line: waited.n, text: waited.text });
    const notes = why.files.length > 10 ? [`${why.files.length} files changed; the evidence lists the first 10.`] : [];

    return [
      {
        id: this.id,
        title: noTechTree
          ? "ModuleManager patches from scratch on every startup: no TechTree node after patching"
          : `ModuleManager patched from scratch: ${why.text}`,
        subject: folders.length === 1 ? folders[0] : undefined,
        mods: noTechTree ? undefined : refs(...folders.map((f) => folderRef(f, folders.length === 1 ? "culprit" : "shared"))),
        where: { phase: "countdown" },
        cost:
          seconds !== undefined
            ? { kind: "measured", seconds, method: "time the main thread waited for ModuleManager's patching; loading a cache also takes some of it" }
            : { kind: "not-measured", method: "no \"[ModuleManager] Waited\" line in KSP.log" },
        evidence,
        action: noTechTree
          ? "A patch deletes or renames the TechTree node, so ModuleManager saves no ModuleManager.TechTree file and its next cache check fails. Find the patch on TechTree in the ModuleManager section of KSP.log and report it to the mod that ships it."
          : "None needed: ModuleManager saved its cache, and the next startup loads it unless a mod or config file changes again.",
        cause: "ModuleManager patching from scratch",
        remedy: noTechTree ? "report" : "none",
        confidence: "measured",
        informational: !noTechTree,
        notes: noTechTree ? [`This startup's reason: ${why.text}.`, ...notes] : notes,
      },
    ];
  },
};
