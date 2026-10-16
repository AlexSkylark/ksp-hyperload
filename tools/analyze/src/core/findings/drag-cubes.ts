// Drag cubes generated during the Countdown.
//
// [C] KSP (and KSPCF's DragCubeGeneration) logs "Creating drag cubes for part
// '<name>'" for each part whose drag cubes are not in PartDatabase.cfg.
// ModuleManager deletes PartDatabase.cfg whenever it patches without a cache,
// so with an unsaved MM cache every startup regenerates them all.
//
// [C] With the .jsonl, the cost is measured: the profiler times each part's
// SetupDragCubeCoroutine from its first step to its last, frames included
// (mechanisms.md, 3.2). That covers every part that goes through it,
// including the few that find their cubes in the database, so the profiler's
// count can be a little above the log's.

import { phaseOf } from "../timeline.js";
import type { Run } from "../run.js";
import type { Evidence, Facts, Finding, Rule } from "./types.js";
import { mmCacheNotSaved } from "./mm-cache.js";

const CREATING = /Creating drag cubes for part '/;
/** Below this estimated cost a one-off generation (e.g. after installing a mod) is not worth a finding. */
const MIN_SECONDS = 1;
const SPAN = /^DragCubeSystem.SetupDragCubeCoroutine(.*) span$/;

/** The profiler's per-part drag cube spans in the Countdown, when the .jsonl has them. */
function profilerSpan(run: Run): { ms: number; parts: number } | undefined {
  let found: { ms: number; parts: number } | undefined;
  for (const r of run.records) {
    if (r.kind !== "aggregate" || r.name !== "partLoader.methods" || !SPAN.test(r.detail) || phaseOf(run, r.t, 0).phase !== "countdown") continue;
    found = { ms: (found?.ms ?? 0) + r.total, parts: (found?.parts ?? 0) + (r.count ?? 0) };
  }
  return found;
}

export const dragCubesRegenerated: Rule = {
  id: "drag-cubes-regenerated",
  needs: "log",
  detects: "drag cubes generated at startup",
  run(run: Run, facts: Facts): Finding[] {
    const menu = run.log.findIndex((l) => l.text.includes("Scene Change : From LOADING to MAINMENU"));
    const countdown = menu < 0 ? run.log : run.log.slice(0, menu);

    // Upper bound: the time from each line to the next one also holds any
    // other work done before the next line, and the frames KSPCF yields.
    let seconds = 0;
    const lines = [];
    for (let i = 0; i < countdown.length; i++) {
      if (!CREATING.test(countdown[i].text)) continue;
      lines.push(countdown[i]);
      const next = countdown[i + 1];
      if (next && next.t > countdown[i].t) seconds += next.t - countdown[i].t;
    }
    if (!lines.length) return [];

    const span = profilerSpan(run);
    if (span) seconds = span.ms / 1000;
    const everyStartup = mmCacheNotSaved.run(run, facts).length > 0;
    if (!everyStartup && seconds < MIN_SECONDS) return [];

    const evidence: Evidence[] = [lines[0], lines[1], lines[lines.length - 1]]
      .filter((l, i, a) => l && a.indexOf(l) === i)
      .map((l): Evidence => ({ source: "log", line: l.n, text: l.text }));
    if (span) evidence.push({ source: "profiler", text: `SetupDragCubeCoroutine, first step to last: ${span.parts} parts, ${Math.round(span.ms)} ms` });

    return [
      {
        id: this.id,
        title: everyStartup
          ? `Drag cubes regenerated for ${lines.length} parts on every startup`
          : `Drag cubes generated for ${lines.length} parts during this startup`,
        where: { phase: "countdown" },
        cost: span
          ? { kind: "measured", seconds, method: "profiler: each part's SetupDragCubeCoroutine, first step to last, frames included" }
          : { kind: "estimated", seconds, method: "upper bound: sum of the time from each \"Creating drag cubes\" line to the next log line" },
        evidence,
        action: everyStartup
          ? "Follows from the unsaved ModuleManager cache: once MM saves its cache, it keeps PartDatabase.cfg and KSP reuses the drag cubes stored there."
          : "Expected once after installing or updating mods. If every startup shows it, PartDatabase.cfg in the KSP folder is not being kept.",
        cause: "drag cube regeneration",
        remedy: everyStartup ? "fix" : "none",
        confidence: everyStartup ? "measured" : "heuristic",
        related: everyStartup ? [mmCacheNotSaved.id] : undefined,
        ...(span && span.parts !== lines.length
          ? { notes: [`The profiler timed ${span.parts} parts and KSP.log shows ${lines.length} generated: the rest went through the same code and found their cubes in the database.`] }
          : {}),
      },
    ];
  },
};
