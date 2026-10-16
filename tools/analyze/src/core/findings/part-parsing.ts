// Part compilation time per mod (informational).
//
// From the profiler's part.parse.byMod aggregates: time spent compiling each
// part, grouped by the GameData folder its config comes from.

import { STOCK_FOLDERS } from "../mods.js";
import type { Run } from "../run.js";
import type { Finding, Rule } from "./types.js";

/** Mods listed as evidence. */
const SHOWN = 8;

export const partParsingByMod: Rule = {
  id: "part-parsing-by-mod",
  needs: "profiler",
  detects: "part compilation time per mod",
  run(run: Run): Finding[] {
    const byMod = new Map<string, { ms: number; parts: number }>();
    for (const r of run.records.filter((r) => r.kind === "aggregate" && r.name === "part.parse.byMod" && !String(r.detail).startsWith("(other"))) {
      const e = byMod.get(r.detail) ?? { ms: 0, parts: 0 };
      e.ms += r.total;
      e.parts += r.count ?? 0;
      byMod.set(r.detail, e);
    }
    // Stock folders count in the totals, but a stock-only install gets no finding.
    const mods = [...byMod].filter(([mod]) => !STOCK_FOLDERS.has(mod));
    if (!mods.length) return [];

    const all = [...byMod].sort((a, b) => b[1].ms - a[1].ms);
    const ms = all.reduce((s, [, e]) => s + e.ms, 0);
    const parts = all.reduce((s, [, e]) => s + e.parts, 0);
    return [
      {
        id: this.id,
        title: `Part compilation: ${parts} parts from ${all.length} folders`,
        where: { phase: "countdown" },
        cost: { kind: "measured", seconds: ms / 1000, method: "profiler: time compiling each part, by the GameData folder of its config" },
        evidence: all.slice(0, SHOWN).map(([mod, e]) => ({
          source: "profiler",
          text: `${mod}: ${e.parts} parts, ${(e.ms / 1000).toFixed(1)} s (${(e.ms / Math.max(e.parts, 1)).toFixed(0)} ms per part)`,
        })),
        action: "Informational: nothing to fix. Every installed part is compiled at startup, so mods with many parts, or with slow ones, cost more here.",
        cause: "part compilation",
        remedy: "none",
        confidence: "measured",
        informational: true,
        // Compiling a part runs its modules' PartModule.Load, so the module time other findings charge to mods falls inside this.
        notes: ["Includes the PartModule Load time that other findings charge to the mods whose modules it is."],
      },
    ];
  },
};
