// Scene switches that used KSP's buffered mode while KSPCF's direct switch was not applied.
//
// [C] HighLogic.LoadScene asks SceneTransitionMatrix whether a switch is
// buffered: an empty scene first, an unused-asset cleanup and a GC, then an
// async load. Each switch is logged as "Scene Change : From X to Y", with
// "(Async)" when buffered. KSPCF's ForceSyncSceneSwitch makes every switch
// direct; KSPCF logs one line per patch, so its absence or state is in the
// log (docs/mechanisms.md, 2.1 and 2.4). The rule reports the effect seen
// on this install, and needs no table of KSPCF defaults. Mods turn the patch
// off through ModuleManager patches on KSP_COMMUNITY_FIXES; MM's patch log
// names each one, but not what it changed (2.2).

import { kspcfPatches, type KspcfPatch } from "../kspcf.js";
import type { LogLine } from "../log.js";
import { folderOfUrl } from "../mods.js";
import type { Run } from "../run.js";
import type { Evidence, Finding, Rule } from "./types.js";

/** KSPCF's patch for SceneTransitionMatrix.GetTransitionValue (KSPCF 1.36.0+). */
const SYNC_SWITCH_PATCH = "ForceSyncSceneSwitch";
const BUFFERED = /Scene Change : From (\w+) to (\w+) \(Async\)/;
const APPLIED_TO_SETTINGS = /^Applying update (\S+) to KSPCommunityFixes\/Settings\.cfg\/KSP_COMMUNITY_FIXES/;
const PRESENT = /^Config\(@KSP_COMMUNITY_FIXES[^)]*\) (\S+)/;
/** Scene Change lines shown as evidence. */
const EVIDENCE_SWITCHES = 3;

/** The mod a patch serves: the positive mods in its NEEDS[...], or the folder it lives in. */
export function patchMod(url: string): string {
  const needs = /:NEEDS\[([^\]]+)\]/i.exec(url);
  const mods = needs?.[1].split(/[,&|]/).filter((m) => m && !m.startsWith("!"));
  return mods?.length ? mods.join(", ") : folderOfUrl(url);
}

/** Why the patch is not applied, in the player's terms. */
function why(p: KspcfPatch): string {
  switch (p.state) {
    case "off-in-settings":
      return "it is off in KSPCommunityFixes' settings";
    case "not-applicable":
      return `KSPCommunityFixes did not apply it (${p.reason})`;
    case "wrong-ksp-version":
      return "KSPCommunityFixes says it does not apply to this KSP version";
    default:
      return "KSPCommunityFixes failed to apply it (see the error in KSP.log)";
  }
}

/** ModuleManager patches on KSPCF's settings: the ones applied, else the ones present in GameData. */
function candidates(run: Run): { lines: LogLine[]; applied: boolean } {
  // In the startup's dump: this startup's patching, or the nested patch log of
  // the startup that built the cache in use, which applied the same patches (1.6).
  const dump = run.mmDumps[0];
  const applied = [...(dump?.lines ?? []), ...(dump?.patchLog ?? [])].filter((l) => APPLIED_TO_SETTINGS.test(l.text));
  return applied.length ? { lines: applied, applied: true } : { lines: run.log.filter((l) => PRESENT.test(l.text)), applied: false };
}

export const bufferedSceneSwitch: Rule = {
  id: "buffered-scene-switch",
  needs: "log",
  detects: "scene switches buffered while KSPCommunityFixes' direct switch is not applied",
  run(run: Run): Finding[] {
    const patch = kspcfPatches(run.log).get(SYNC_SWITCH_PATCH);
    if (!patch || patch.state === "applied") return [];
    const buffered = run.log.filter((l) => BUFFERED.test(l.text));
    if (!buffered.length) return [];

    const settings = patch.state === "off-in-settings";
    const found = settings ? candidates(run) : { lines: [], applied: false };
    const mods = [...new Set(found.lines.map((l) => patchMod((APPLIED_TO_SETTINGS.exec(l.text) ?? PRESENT.exec(l.text))![1])))];
    const switches = buffered.map((l) => BUFFERED.exec(l.text)!).map((m) => `${m[1]}->${m[2]}`);

    const evidence: Evidence[] = [patch.line, ...buffered.slice(0, EVIDENCE_SWITCHES), ...found.lines].map((l) => ({ source: "log", line: l.n, text: l.text }));
    const notes = [`Buffered switches: ${switches.join(", ")}.`];
    if (settings) {
      notes.push(
        found.applied
          ? "Candidates are the ModuleManager patches applied to KSPCommunityFixes' settings in this run. KSP.log does not show which setting each one changes."
          : found.lines.length
            ? "Candidates are the patches on KSPCommunityFixes' settings found in GameData. KSP.log does not show whether they applied, or which setting each one changes."
            : "No ModuleManager patch on KSPCommunityFixes' settings shows in KSP.log.",
        "It may also have been turned off by hand, in KSPCommunityFixes/Settings.cfg.",
      );
    }
    return [
      {
        id: this.id,
        title: `${buffered.length} scene switch${buffered.length > 1 ? "es" : ""} used KSP's buffered mode: KSPCommunityFixes' ${SYNC_SWITCH_PATCH} is not applied${mods.length ? ` (candidates: ${mods.join("; ")})` : ""}`,
        subject: SYNC_SWITCH_PATCH,
        where: { phase: "session" },
        cost: { kind: "not-measured", method: "KSPCF pull request #250 reports 4–7 s per scene switch on a large modpack; measuring it here would take runs in both modes" },
        evidence,
        action: settings
          ? `This is a trade-off, not an error: ${why(patch)}, so each switch loads an empty scene and cleans up memory before loading the next one. A mod's compatibility patch usually turns it off on purpose, so keep it off while that mod is installed. The choice is between the mod and faster scene switches.`
          : `${why(patch)[0].toUpperCase()}${why(patch).slice(1)}, so each switch loads an empty scene and cleans up memory before loading the next one.`,
        confidence: "measured",
        notes,
      },
    ];
  },
};
