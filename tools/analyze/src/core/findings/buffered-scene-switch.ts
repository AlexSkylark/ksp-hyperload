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
//
// [C] With the profiler, the cost is measured per Hold (6.2): the time inside
// HighLogic.bufferedLoad's steps (the empty scene, the cleanup and the GC
// before the async load), plus the time the loading overlay stays up after
// the scene's GUI is ready: a direct switch hides it at scene load for the
// space center and the editor, so only Holds into those count it (flight
// waits for its vessel either way). The cleanups KSP runs inside the async load itself are not timed
// apart, so the cost is a lower bound.

import { kspcfPatches, type KspcfPatch } from "../kspcf.js";
import type { LogLine } from "../log.js";
import { folderOfUrl } from "../mods.js";
import type { Run } from "../run.js";
import type { Evidence, Finding, Place, Rule } from "./types.js";
import { addPlace, ranked } from "./places.js";

/** KSPCF's patch for SceneTransitionMatrix.GetTransitionValue (KSPCF 1.36.0+). */
const SYNC_SWITCH_PATCH = "ForceSyncSceneSwitch";
const BUFFERED = /Scene Change : From (\w+) to (\w+) \(Async\)/;
const APPLIED_TO_SETTINGS = /^Applying update (\S+) to KSPCommunityFixes\/Settings\.cfg\/KSP_COMMUNITY_FIXES/;
const PRESENT = /^Config\(@KSP_COMMUNITY_FIXES[^)]*\) (\S+)/;
/** Scene Change lines shown as evidence. */
const EVIDENCE_SWITCHES = 3;
const PR_NOTE = "KSPCF pull request #250 reports 4–7 s per scene switch on a large modpack";
const SWITCH = /Scene Change : From (\w+) to (\w+)( \(Async\))?/;
/** Targets whose overlay a direct switch hides at scene load (6.2). */
const OVERLAY_TARGETS = new Set(["SPACECENTER", "EDITOR"]);
/** Allowance between a transition's end and its overlay record. */
const OVERLAY_SLACK_MS = 1000;

/**
 * The profiler's measured cost of each buffered Hold. Profiler transitions are
 * paired in order with the "Scene Change" lines of the same switch; a buffered
 * line counts its Hold's bufferedLoad steps and overlay wait.
 */
function measuredHolds(run: Run): { places: Place[]; seconds: number; evidence: Evidence[] } | undefined {
  const transitions = run.records.filter((r) => r.kind === "span" && r.name === "scene.transition" && r.detail !== "LOADING->MAINMENU");
  const lines = run.log.map((l) => SWITCH.exec(l.text)).filter((m): m is RegExpExecArray => !!m && m[1] !== "LOADING");
  const places = new Map<string, Place>();
  const evidence: Evidence[] = [];
  let next = 0;
  for (const tr of transitions) {
    if (tr.kind !== "span") continue;
    const i = lines.findIndex((m, j) => j >= next && `${m[1]}->${m[2]}` === tr.detail);
    if (i < 0) continue;
    next = i + 1;
    if (!lines[i][3]) continue;
    const end = tr.t + tr.dur;
    let steps = 0;
    let overlay: number | undefined;
    for (const r of run.records) {
      if (r.kind === "span" && r.name === "scene.bufferedLoad.step" && r.t >= tr.t && r.t <= end) steps += r.dur;
      if (r.kind === "counter" && r.name === "scene.overlayAfterGuiReady" && r.detail === tr.detail && r.t >= tr.t && r.t <= end + OVERLAY_SLACK_MS) overlay = (overlay ?? 0) + r.value;
    }
    const counted = OVERLAY_TARGETS.has(lines[i][2]);
    addPlace(places, { phase: "hold", hold: tr.detail! }, (steps + (counted ? overlay ?? 0 : 0)) / 1000);
    evidence.push({
      source: "profiler",
      text: `Hold ${tr.detail}: bufferedLoad steps ${Math.round(steps)} ms, overlay after GUI ready ${!counted ? "not counted (a direct switch waits too)" : overlay === undefined ? "not recorded (profiler older than summary format 2)" : `${Math.round(overlay)} ms`}`,
    });
  }
  if (!evidence.length) return undefined;
  const list = ranked(places).places;
  return { places: list, seconds: list.reduce((s, p) => s + p.seconds, 0), evidence };
}

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

    const measured = measuredHolds(run);
    const evidence: Evidence[] = [
      ...[patch.line, ...buffered.slice(0, EVIDENCE_SWITCHES), ...found.lines].map((l): Evidence => ({ source: "log", line: l.n, text: l.text })),
      ...(measured?.evidence ?? []),
    ];
    const notes = [`Buffered switches: ${switches.join(", ")}.`];
    if (measured) notes.push(`For comparison, ${PR_NOTE}.`);
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
        ...(measured ? { places: measured.places } : {}),
        cost: measured
          ? {
              kind: "measured",
              seconds: measured.seconds,
              method: "profiler: time in HighLogic.bufferedLoad's steps plus the loading overlay's wait after the GUI is ready, per buffered Hold; a lower bound, since the cleanups inside the async load are not timed apart",
            }
          : { kind: "not-measured", method: `${PR_NOTE}; the T-Minus profiler measures it per Hold` },
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
