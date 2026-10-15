// KSPCommunityFixes' per-patch lines in KSP.log (docs/mechanisms.md, 2.1).
//
// [C] BasePatch.Patch logs one line per patch it considers, named by the patch
// class, which is also its Settings.cfg key. The lines are parsed by their
// structure, not by one version's text: KSPCF 1.10 to 1.36 say "disabled in
// Settings.cfg" where 1.37+ say "not enabled in Settings.cfg". Unknown forms
// are left out. A patch with no line is not in this KSPCF version.

import type { LogLine } from "./log.js";

export type KspcfPatchState =
  /** Applied. */
  | "applied"
  /** Off in KSPCF's settings (the key is false or missing). */
  | "off-in-settings"
  /** Not applicable on this install (CanApplyPatch: a missing DLC, a patch it depends on). */
  | "not-applicable"
  /** Outside the patch's KSP version range. */
  | "wrong-ksp-version"
  /** Harmony failed to apply it. */
  | "error";

export interface KspcfPatch {
  /** Patch class name, also its Settings.cfg key. */
  name: string;
  state: KspcfPatchState;
  /** KSPCF's reason, for "not-applicable" and "off-in-settings". */
  reason?: string;
  line: LogLine;
}

const APPLIED = /^\[KSPCommunityFixes\] Patch (\w+) applied\.$/;
const NOT_APPLIED = /^\[KSPCommunityFixes\] Patch (\w+) not applied \((.+)\)$/;
const WRONG_VERSION = /^\[KSPCommunityFixes\] Patch (\w+) isn't applicable to this KSP version\.$/;
/** 1.36+: ", error applying patch"; before: " : {exception}". */
const ERROR = /^\[KSPCommunityFixes\] Patch (\w+) not applied(?:, error applying patch$| : )/;

/** KSPCF's per-patch lines, by patch name; the last line wins if a patch is logged twice. */
export function kspcfPatches(log: LogLine[]): Map<string, KspcfPatch> {
  const patches = new Map<string, KspcfPatch>();
  for (const line of log) {
    if (!line.text.startsWith("[KSPCommunityFixes] Patch ")) continue;
    let m: RegExpExecArray | null;
    if ((m = APPLIED.exec(line.text))) patches.set(m[1], { name: m[1], state: "applied", line });
    else if ((m = WRONG_VERSION.exec(line.text))) patches.set(m[1], { name: m[1], state: "wrong-ksp-version", line });
    else if ((m = ERROR.exec(line.text))) patches.set(m[1], { name: m[1], state: "error", line });
    else if ((m = NOT_APPLIED.exec(line.text))) {
      const settings = /Settings\.cfg/.test(m[2]);
      patches.set(m[1], { name: m[1], state: settings ? "off-in-settings" : "not-applicable", reason: m[2], line });
    }
  }
  return patches;
}
