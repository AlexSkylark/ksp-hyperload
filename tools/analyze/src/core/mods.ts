// The mods installed in a run, from KSP.log itself, and which of them wrote a log line.
//
// Built only from the run's "Load(Assembly): <folder>/.../<assembly>" lines:
// no curated list. A log source that matches no assembly (stock code, Unity,
// a tag the mod chose freely) stays unattributed.

import type { Run } from "./run.js";

export interface Mod {
  /** Assembly name, e.g. "ProgressiveCBMaps". */
  assembly: string;
  /** First folder under GameData, e.g. "REPOSoftTech". */
  folder: string;
  /** How the report names it: the assembly, with its folder when that differs. */
  name: string;
}

/** Folders whose log lines are not mod work: stock, and T-Minus itself (old name included). */
const NOT_MODS = new Set(["Squad", "SquadExpansion", "000_TMinus", "000_HyperLoad"]);
/** A source this short can only match an assembly name exactly. */
const MIN_PREFIX = 6;

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

const cache = new WeakMap<Run, { mod: Mod; key: string }[]>();

function installed(run: Run): { mod: Mod; key: string }[] {
  let mods = cache.get(run);
  if (mods) return mods;
  const seen = new Map<string, { mod: Mod; key: string }>();
  for (const l of run.log) {
    const m = /^Load\(Assembly\): ([^/]+)\/(?:.*\/)?([^/]+)$/.exec(l.text);
    if (!m || NOT_MODS.has(m[1])) continue;
    const [, folder, assembly] = m;
    const key = norm(assembly);
    if (key && !seen.has(key)) seen.set(key, { mod: { assembly, folder, name: norm(folder) === key ? assembly : `${assembly} (${folder})` }, key });
  }
  // Longest names first, so a prefix match picks the most specific assembly.
  mods = [...seen.values()].sort((a, b) => b.key.length - a.key.length);
  cache.set(run, mods);
  return mods;
}

/**
 * The installed mod a log source belongs to, if any. Matches when the source
 * equals an assembly name, starts with one ("ProgressiveCBMaps-EVEWrapper"),
 * or is the start of one ("Parallax" for "ParallaxContinued"), ignoring case
 * and punctuation.
 */
export function modOfSource(run: Run, source: string): Mod | undefined {
  const s = norm(source);
  if (!s) return undefined;
  const mods = installed(run);
  return (
    mods.find(({ key }) => s === key) ??
    mods.find(({ key }) => key.length >= MIN_PREFIX && s.startsWith(key)) ??
    (s.length >= MIN_PREFIX ? mods.find(({ key }) => key.startsWith(s)) : undefined)
  )?.mod;
}
