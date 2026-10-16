// ModuleManager exports the whole config database on every startup (-mm-dump).
//
// [C] With -mm-dump on the command line, MM's post-patch step deletes
// _MMCfgOutput and writes every config file there, logging
// "Exporting {file}" for each, before "Post patch ran in"
// (ModuleManager.OutputAllConfigs, docs/mechanisms.md, 1.8). It is a
// debugging aid. KSP lists the command line in its environment block
// ("Args: ..."), which says it is on for every startup made the same way.

import type { Run } from "../run.js";
import type { Evidence, Finding, Rule } from "./types.js";

const MIN_SECONDS = 0.5;
const ARGS = /\bArgs: .*(?:^|\s)-mm-dump(?:\s|$)/;

export const mmDumpEveryStartup: Rule = {
  id: "mm-dump-every-startup",
  needs: "log",
  detects: "ModuleManager's -mm-dump export",
  run(run: Run): Finding[] {
    // This startup's export: it ends at the first "Post patch ran in"; MM's menu reload can export again later.
    const end = run.log.findIndex((l) => l.text.startsWith("[ModuleManager] Post patch ran in"));
    if (end < 0) return [];
    const exports = run.log.slice(0, end).filter((l) => l.text.startsWith("[ModuleManager] Exporting "));
    if (!exports.length) return [];
    const seconds = run.log[end].t - exports[0].t;

    const args = run.log.flatMap((l) => l.more ?? []).find((m) => ARGS.test(m.text));
    if (seconds < MIN_SECONDS && !args) return [];
    const evidence: Evidence[] = [];
    if (args) evidence.push({ source: "log", line: args.n, text: args.text.trim() });
    evidence.push(...[exports[0], exports[exports.length - 1], run.log[end]].map((l) => ({ source: "log" as const, line: l.n, text: l.text })));
    return [
      {
        id: this.id,
        title: `ModuleManager exported ${exports.length} config files (-mm-dump)`,
        subject: "ModuleManager",
        where: { phase: "countdown" },
        cost: {
          kind: "estimated",
          seconds,
          method: "from the first \"[ModuleManager] Exporting\" line to \"Post patch ran in\"; the deletion of the previous export before it is not counted",
        },
        evidence,
        action: "Remove -mm-dump from KSP's launch options unless you are debugging ModuleManager patches; the export in _MMCfgOutput is only for reading.",
        cause: "ModuleManager's config export (-mm-dump)",
        remedy: "fix",
        confidence: "measured",
        notes: args ? [] : ["KSP.log does not show the command line, so it may not be set for every startup."],
      },
    ];
  },
};
