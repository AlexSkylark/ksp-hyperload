// ModuleManager did not save its config cache.
//
// [C] MM saves its cache only when patching had no errors and no exceptions.
// Otherwise it logs "Errors in patch prevents the creation of the cache", one
// "<n> error(s) related to GameData/<file>" line per file under its status
// line, and patches from scratch on every startup. Its patch log is dumped
// into KSP.log between "#### BEGIN/END MODULEMANAGER LOG ####".

import type { LogLine } from "../log.js";
import type { Run } from "../run.js";
import type { Evidence, Finding, Rule } from "./types.js";

const NOT_SAVED = "Errors in patch prevents the creation of the cache";
const RELATED = /^(\d+) errors? related to GameData\/(.+)$/;

/** Lines of the MM patch log dumped into KSP.log; the whole log when the markers are missing. */
function mmDump(log: LogLine[]): LogLine[] {
  const has = (l: LogLine, marker: string) => l.more?.some((m) => m.text.includes(marker));
  const begin = log.findIndex((l) => has(l, "#### BEGIN MODULEMANAGER LOG ####"));
  const end = log.findIndex((l, i) => i > begin && has(l, "#### END MODULEMANAGER LOG ####"));
  return begin < 0 || end < 0 ? log : log.slice(begin + 1, end + 1);
}

/** The first folder under GameData: the mod that ships the file. */
const modOf = (file: string) => file.split("/")[0];

export const mmCacheNotSaved: Rule = {
  id: "mm-cache-not-saved",
  needs: "log",
  detects: "ModuleManager cache not saved",
  run(run: Run): Finding[] {
    const notSaved = run.log.find((l) => l.text.includes(NOT_SAVED));
    if (!notSaved) return [];

    const dump = mmDump(run.log);
    const status = dump.find((l) => /^ModuleManager: \d+ patches applied/.test(l.text));
    const files = (status?.more ?? []).flatMap((m) => {
      const r = RELATED.exec(m.text.trim());
      return r ? [{ line: m.n, text: m.text.trim(), count: Number(r[1]), file: r[2] }] : [];
    });
    const isError = (l: LogLine) => l.level === "ERR" || l.level === "EXC";
    const waited = run.log.find((l) => /^\[ModuleManager\] Waited [\d.]+s for patching to finish/.test(l.text));
    const seconds = waited && Number(/Waited ([\d.]+)s/.exec(waited.text)![1]);

    const evidence: Evidence[] = [notSaved, ...(status ? [status] : [])].map((l) => ({ source: "log", line: l.n, text: l.text }));
    evidence.push(...files.map((f) => ({ source: "log" as const, line: f.line, text: f.text })));
    if (waited) evidence.push({ source: "log", line: waited.n, text: waited.text });
    // Each error with the patch application it happened in, which names the patched part.
    let applying: LogLine | undefined;
    for (const l of dump) {
      if (l.text.startsWith("Applying update ")) applying = l;
      if (!isError(l)) continue;
      if (applying) evidence.push({ source: "log", line: applying.n, text: applying.text });
      applying = undefined;
      evidence.push({ source: "log", line: l.n, text: `[${l.level}] ${l.text}` });
    }

    const mods = [...new Set(files.map((f) => modOf(f.file)))];
    const named = files.length === 1 ? files[0].file : files.length ? `${files.length} files` : undefined;
    return [
      {
        id: this.id,
        title: `ModuleManager did not save its cache${named ? `: errors in ${named}` : ""}`,
        subject: mods.length === 1 ? mods[0] : undefined,
        where: { phase: "countdown" },
        cost:
          seconds !== undefined
            ? {
                kind: "measured",
                seconds,
                method: "time the main thread waited for ModuleManager's patching; with a saved cache, MM loads the cache instead, and that time is not measured on this install",
              }
            : { kind: "not-measured", method: "no \"[ModuleManager] Waited\" line in KSP.log" },
        evidence,
        action:
          (files.length
            ? `Fix or remove the patch file${files.length > 1 ? "s" : ""} named in the evidence, or report the errors to the mod that ships ${files.length > 1 ? "each one" : "it"}. `
            : "Find the patch errors in the ModuleManager section of KSP.log and report them to the mod that ships each patch. ") +
          "Once patching has no errors, ModuleManager saves its cache and later startups load it instead of patching again, until a mod or config file changes.",
        confidence: "measured",
        notes: ["Without a cache, ModuleManager also deletes PartDatabase.cfg, so KSP regenerates drag cubes on the next startup."],
      },
    ];
  },
};
