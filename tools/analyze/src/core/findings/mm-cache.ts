// ModuleManager did not save its config cache.
//
// [C] MM saves its cache only when patching had no errors and no exceptions.
// Otherwise it logs "Errors in patch prevents the creation of the cache", one
// "<n> error(s) related to GameData/<file>" line per file under its status
// line, deletes the cache, and patches from scratch on every startup. All of
// it is in MM's log, which reaches KSP.log only as the dump (docs/mechanisms.md,
// 1.3 and 1.6). A cache write that fails ends the same way. Without the
// startup's dump the rule reports nothing.

import { DECIMAL, decimal, type LogLine } from "../log.js";
import { folderOfUrl, folderRef, sharedRole } from "../mods.js";
import type { Run } from "../run.js";
import type { Evidence, Finding, Rule } from "./types.js";
import { refs } from "./places.js";

const NOT_SAVED = "Errors in patch prevents the creation of the cache";
// [C] CreateCache: a write that throws deletes both files again; a failed SHA
// write alone leaves the cache without its SHA. Either way the next check fails.
const WRITE_FAILED = /^(An error occured while creating the cache|Exception while saving the sha|(NullReference)?Exception while saving the cache)/;
const EXCEPTIONS = /encountered (?:<color=\w+>)?(\d+) exceptions?/;
const PERCENT = /patch(?:es)? applied \(([^)]+)\)/;

/** The line saying this startup did not save its cache: patch errors, or a failed write. */
export const cacheNotSavedLine = (lines: LogLine[]) =>
  lines.find((l) => l.text.includes(NOT_SAVED)) ?? lines.find((l) => (l.level === "ERR" || l.level === "EXC") && WRITE_FAILED.test(l.text));
const RELATED = /^(\d+) errors? related to GameData\/(.+)$/;
const WAITED = new RegExp(String.raw`^\[ModuleManager\] Waited (${DECIMAL})s for patching to finish`);

export const mmCacheNotSaved: Rule = {
  id: "mm-cache-not-saved",
  needs: "log",
  detects: "ModuleManager cache not saved",
  run(run: Run): Finding[] {
    // The startup's dump; later ones come from database reloads in MM's menu.
    // Only this startup's lines: a nested patch log belongs to an earlier one.
    const dump = run.mmDumps[0];
    if (!dump?.complete) return [];
    const notSaved = cacheNotSavedLine(dump.lines);
    if (!notSaved) return [];

    const status = dump.lines.find((l) => /^ModuleManager: \d+ patch(es)? applied/.test(l.text));
    const files = (status?.more ?? []).flatMap((m) => {
      const r = RELATED.exec(m.text.trim());
      return r ? [{ line: m.n, text: m.text.trim(), count: Number(r[1]), file: r[2] }] : [];
    });
    const isError = (l: LogLine) => l.level === "ERR" || l.level === "EXC";
    const waited = run.log.find((l) => WAITED.test(l.text));
    const seconds = waited && decimal(WAITED.exec(waited.text)![1]);

    const evidence: Evidence[] = [notSaved, ...(status ? [status] : [])].map((l) => ({ source: "log", line: l.n, text: l.text }));
    evidence.push(...files.map((f) => ({ source: "log" as const, line: f.line, text: f.text })));
    if (waited) evidence.push({ source: "log", line: waited.n, text: waited.text });
    // Each error with the patch application it happened in, which names the patched part.
    let applying: LogLine | undefined;
    for (const l of dump.lines) {
      if (l.text.startsWith("Applying update ")) applying = l;
      if (!isError(l)) continue;
      if (applying) evidence.push({ source: "log", line: applying.n, text: applying.text });
      applying = undefined;
      evidence.push({ source: "log", line: l.n, text: `[${l.level}] ${l.text}` });
    }

    const mods = [...new Set(files.map((f) => folderOfUrl(f.file)))];
    const named = files.length === 1 ? files[0].file : files.length ? `${files.length} files` : undefined;
    const writeFailed = !notSaved.text.includes(NOT_SAVED);
    const exceptions = Number(status && EXCEPTIONS.exec(status.text)?.[1]) || 0;
    const percent = status && PERCENT.exec(status.text)?.[1];
    const notes = ["Without a cache, ModuleManager also deletes PartDatabase.cfg, so KSP regenerates drag cubes on the next startup."];
    if (exceptions)
      notes.push(`Patching threw ${exceptions} exception${exceptions === 1 ? "" : "s"}; ModuleManager counts them like errors (one in a NEEDS check counts twice).`);
    if (percent) notes.push(`ModuleManager applied ${percent} of its patches: a patch that threw is not counted as applied.`);
    return [
      {
        id: this.id,
        title: writeFailed ? "ModuleManager could not write its cache" : `ModuleManager did not save its cache${named ? `: errors in ${named}` : ""}`,
        subject: mods.length === 1 ? mods[0] : undefined,
        mods: refs(...mods.map((m) => folderRef(m, sharedRole(mods.length)))),
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
        action: writeFailed
          ? "Writing ModuleManager.ConfigCache or ModuleManager.ConfigSHA in GameData failed (the exception is in the evidence). Check that GameData is writable (not read-only, not blocked by antivirus or a sync folder) and the disk has space; then later startups load the cache."
          : (files.length
            ? `Fix or remove the patch file${files.length > 1 ? "s" : ""} named in the evidence, or report the errors to ${mods.length > 1 ? `the mod that ships each one (${mods.join(", ")})` : `the authors of ${mods[0]}, which ships ${files.length > 1 ? "them" : "it"}`}. `
            : "Find the patch errors in the ModuleManager section of KSP.log and report them to the mod that ships each patch. ") +
          "Once patching has no errors, ModuleManager saves its cache and later startups load it instead of patching again, until a mod or config file changes.",
        cause: "ModuleManager patching from scratch (cache not saved)",
        remedy: "fix",
        confidence: "measured",
        notes,
      },
    ];
  },
};
