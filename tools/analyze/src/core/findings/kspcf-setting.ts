// A KSPCommunityFixes optimization that is on by default, found off.
//
// [C] KSPCF logs "[KSPCommunityFixes] Patch <name> not applied (not enabled in
// Settings.cfg)" for every patch it skips. Most of those are off by default,
// and KSP.log does not say which, so the rule only looks at the patches in
// OPTIMIZATIONS. Mods turn them off through ModuleManager patches on the
// KSP_COMMUNITY_FIXES node; MM's patch log (dumped into KSP.log, also when
// the cache is used) names each patch it applied to it, but not what the
// patch changed.

import type { Run } from "../run.js";
import type { Evidence, Finding, Rule } from "./types.js";

interface Optimization {
  patch: string;
  /** What turning it off costs, in the player's terms. */
  effect: string;
  /** Outside figure for the cost, with its source. */
  costSource: string;
}

/** KSPCF patches that speed up loading or scene switches and are on by default (Settings.cfg of KSPCF 1.41.1). */
const OPTIMIZATIONS: Optimization[] = [
  {
    patch: "ForceSyncSceneSwitch",
    effect: "every Hold goes through KSP's slower buffered scene switch",
    costSource: "KSPCF pull request #250 reports 4–7 s per scene switch on a large modpack",
  },
];

const APPLIED_TO_SETTINGS = /^Applying update (\S+) to KSPCommunityFixes\/Settings\.cfg\/KSP_COMMUNITY_FIXES/;
const PRESENT = /^Config\(@KSP_COMMUNITY_FIXES[^)]*\) (\S+)/;

/** The mod a patch serves: the positive mods in its NEEDS[...], or the folder it lives in. */
export function patchMod(url: string): string {
  const needs = /:NEEDS\[([^\]]+)\]/i.exec(url);
  const mods = needs?.[1].split(/[,&|]/).filter((m) => m && !m.startsWith("!"));
  return mods?.length ? mods.join(", ") : url.split("/")[0];
}

export const kspcfOptimizationOff: Rule = {
  id: "kspcf-optimization-off",
  needs: "log",
  detects: "KSPCommunityFixes optimizations turned off",
  run(run: Run): Finding[] {
    // MM's patch applications are in the startup's dump: this startup's when it
    // patched, else the nested patch log of the startup that built the cache in
    // use, which applied the same patches (docs/mechanisms.md, 1.6).
    const dump = run.mmDumps[0];
    const applied = [...(dump?.lines ?? []), ...(dump?.patchLog ?? [])].filter((l) => APPLIED_TO_SETTINGS.test(l.text));
    const present = run.log.filter((l) => PRESENT.test(l.text));
    const candidates = applied.length ? applied : present;
    const urls = [...new Set(candidates.map((l) => (APPLIED_TO_SETTINGS.exec(l.text) ?? PRESENT.exec(l.text))![1]))];
    const mods = [...new Set(urls.map(patchMod))];

    return OPTIMIZATIONS.flatMap((o) => {
      const off = run.log.find((l) => l.text === `[KSPCommunityFixes] Patch ${o.patch} not applied (not enabled in Settings.cfg)`);
      if (!off) return [];

      const evidence: Evidence[] = [off, ...candidates].map((l) => ({ source: "log", line: l.n, text: l.text }));
      const notes = [
        applied.length
          ? "Candidates are the ModuleManager patches applied to KSPCommunityFixes' settings in this run. KSP.log does not show which setting each one changes."
          : candidates.length
            ? "Candidates are the patches on KSPCommunityFixes' settings found in GameData. KSP.log does not show whether they applied, or which setting each one changes."
            : "No ModuleManager patch on KSPCommunityFixes' settings shows in KSP.log.",
        "It may also have been turned off by hand, in KSPCommunityFixes/Settings.cfg.",
      ];
      return [
        {
          id: this.id,
          title: `KSPCommunityFixes' ${o.patch} is off${mods.length ? ` (candidates: ${mods.join("; ")})` : ""}`,
          subject: o.patch,
          where: { phase: "session" },
          cost: { kind: "not-measured", method: o.costSource },
          evidence,
          action: `This is a trade-off, not an error: with ${o.patch} off, ${o.effect}. A mod's compatibility patch usually turns it off on purpose, so keep it off while that mod is installed. The choice is between the mod and the faster loading.`,
          confidence: "heuristic",
          notes,
        },
      ];
    });
  },
};
