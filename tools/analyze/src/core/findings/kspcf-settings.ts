// KSPCF did not read its settings: more than one KSP_COMMUNITY_FIXES node.
//
// [C] KSPCF reads its settings from the game database only when exactly one
// KSP_COMMUNITY_FIXES node exists; otherwise every key is missing, so every
// patch that reads its key logs "not applied (... Settings.cfg)", silently
// (docs/mechanisms.md, 2.1 step 2, and 2.2). A second node can come from
// another mod's file or a ModuleManager copy. GameDatabase logs each root
// node of each config file as "Config(NAME) url", so the files that hold one
// are in KSP.log; a copy patch shows as "Config(+NAME...)".
//
// With the profiler, its node count is direct evidence. From KSP.log alone the
// rule reads KSPCF's own signature: almost every patch off in settings. A hand
// edit that turns everything off looks the same, so that is heuristic.

import { kspcfPatches } from "../kspcf.js";
import { folderOfUrl, folderRef, sharedRole } from "../mods.js";
import type { Run } from "../run.js";
import type { Evidence, Facts, Finding, Rule } from "./types.js";
import { refs } from "./places.js";

/** The signature: at least this share of KSPCF's patch lines off in settings... */
const OFF_SHARE = 0.9;
/** ...out of at least this many lines, so a KSPCF with few patches is not read as one. */
const MIN_PATCH_LINES = 20;
const ROOT_NODE = /^Config\(KSP_COMMUNITY_FIXES\) (\S+)/;
const COPY_NODE = /^Config\(\+KSP_COMMUNITY_FIXES[^)]*\) (\S+)/;

export const kspcfSettingsNotRead: Rule = {
  id: "kspcf-settings-not-read",
  needs: "log",
  detects: "KSPCommunityFixes' settings not read (more than one KSP_COMMUNITY_FIXES node)",
  run(run: Run, facts: Facts): Finding[] {
    const patches = [...kspcfPatches(run.log).values()];
    const off = patches.filter((p) => p.state === "off-in-settings");
    const applied = patches.filter((p) => p.state === "applied");
    const signature = off.length >= MIN_PATCH_LINES && off.length >= OFF_SHARE * (off.length + applied.length);
    const nodes = facts.kspcfSettings?.nodes;
    const counted = nodes !== undefined && nodes > 1;
    // The profiler's count wins over the log's signature when it says there is one node.
    if (!counted && (!signature || nodes !== undefined)) return [];

    const roots = run.log.filter((l) => ROOT_NODE.test(l.text));
    const copies = run.log.filter((l) => COPY_NODE.test(l.text));
    const urls = [...roots.map((l) => ROOT_NODE.exec(l.text)![1]), ...copies.map((l) => COPY_NODE.exec(l.text)![1])];
    const extra = [...new Set(urls.map(folderOfUrl).filter((f) => f !== "KSPCommunityFixes"))];

    const evidence: Evidence[] = [];
    if (counted) evidence.push({ source: "profiler", text: `KSP_COMMUNITY_FIXES nodes in the game database at the main menu: ${nodes}` });
    evidence.push(...[...roots, ...copies].map((l): Evidence => ({ source: "log", line: l.n, text: l.text })));
    evidence.push(...off.slice(0, 3).map((p): Evidence => ({ source: "log", line: p.line.n, text: p.line.text })));
    const notes = [`KSPCommunityFixes logged ${off.length} patches off in settings and ${applied.length} applied (the applied ones do not read a key).`];
    if (!counted) notes.push("Turning every patch off by hand in KSPCommunityFixes/Settings.cfg would look the same in KSP.log; the T-Minus profiler counts the nodes.");

    return [
      {
        id: this.id,
        title: counted
          ? `KSPCommunityFixes did not read its settings: ${nodes} KSP_COMMUNITY_FIXES nodes`
          : "KSPCommunityFixes applied almost none of its patches: its settings were likely not read",
        subject: extra.length === 1 ? extra[0] : "KSPCommunityFixes",
        mods: refs(...extra.map((m) => folderRef(m, sharedRole(extra.length)))),
        where: { phase: "session" },
        cost: { kind: "not-measured", method: "the patches left off are KSPCommunityFixes' fixes and loading optimizations; their effect is not measured on this install" },
        evidence,
        action:
          (extra.length
            ? `Remove the extra KSP_COMMUNITY_FIXES node (the evidence names the file${extra.length > 1 ? "s" : ""} in ${extra.join(", ")}), or report it to that mod. `
            : "Find the second KSP_COMMUNITY_FIXES node (a config file or a ModuleManager copy patch) and remove it. ") +
          "To change KSPCommunityFixes' settings, patch its node with @KSP_COMMUNITY_FIXES instead of adding a new one.",
        confidence: counted ? "measured" : "heuristic",
        notes,
      },
    ];
  },
};
