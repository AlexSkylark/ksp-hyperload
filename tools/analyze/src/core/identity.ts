// What KSP.log says about the machine, and what in it identifies the player,
// the install or the save. The report keeps the first (it helps the
// diagnosis) and redacts the second (design rule 4; docs/m6-web-plan.md,
// decision 7).

import type { Run } from "./run.js";

/** The hardware lines of KSP.log's header ("CPU: ...", "GPU: ..."), as written. */
export interface System {
  /** KSP's version and player, from the log's first line ("1.12.5.3190 (WindowsPlayer x64)"). */
  ksp?: string;
  os?: string;
  cpu?: string;
  /** Megabytes, as KSP writes it. */
  ramMb?: number;
  gpu?: string;
}

/** A name to redact, and what it names. */
export interface Identifier {
  text: string;
  kind: "user" | "save" | "vessel" | "kerbal";
}

export interface Identifying {
  /** Install roots seen in the log's paths (the folder that holds GameData), longest first. */
  roots: string[];
  names: Identifier[];
}

export function system(run: Run): System | undefined {
  const header = run.log[0]?.more ?? [];
  const value = (key: string) => header.find((l) => l.text.startsWith(`${key}: `))?.text.slice(key.length + 2).trim();
  const ram = value("RAM");
  const ksp = /Kerbal Space Program - (.+?)(?: [a-z]{2}-[a-z]{2})? \*+$/.exec(run.log[0]?.text ?? "")?.[1];
  const result: System = { ksp, os: value("OS"), cpu: value("CPU"), ramMb: ram && /^\d+$/.test(ram) ? Number(ram) : undefined, gpu: value("GPU") };
  return Object.values(result).some((v) => v !== undefined) ? result : undefined;
}

/** An absolute path's start: a drive letter, a UNC share, or a Unix root, not inside a word. */
const ABSOLUTE = String.raw`(?<![\w.])(?:[A-Za-z]:[\\/]|\\\\|/)`;
/** The install root before GameData, through a player data folder's "../" when the path has one. */
const ROOT = new RegExp(String.raw`(${ABSOLUTE}[^'"\n<>|*?]*?)[\\/]+(?:[^\\/'"\n]*_Data[\\/]+\.\.[\\/]+)?GameData(?=[\\/'"\s]|$)`, "g");
const USER = /[\\/](?:Users|home)[\\/]([^\\/\s'"]+)/g;
const SAVE = /(?:^|[\\/\s])saves[\\/]+([^\\/\n'"]+?)[\\/]/g;
/** Stock folders under saves/, not a player's save. */
const STOCK_SAVES = new Set(["scenarios", "training", "missions"]);
const CRAFT = /[\\/]([^\\/\n'"]+?)\.craft\b/g;
const SWITCH_VESSEL = /Switching To Vessel (.+?) -{3,}/;
const CREW = /\bCrewmember (.+?) (?:assigned to|is available|has been|was)\b/;
/** A stock-style Kerbal name; a place named like one ("Cape Kerman") is redacted too, which hides nothing the report needs. */
const KERMAN = /\b([A-Z][a-z'-]+ Kerman)\b/g;
/** Names shorter than this are not redacted: they would match ordinary words. */
const MIN_NAME = 3;

/** Every root, user, save, vessel and Kerbal name the log shows, for redaction. */
export function identifying(run: Run): Identifying {
  const roots = new Set<string>();
  const names = new Map<string, Identifier["kind"]>();
  const add = (text: string, kind: Identifier["kind"]) => {
    const t = text.trim();
    if (t.length >= MIN_NAME && !names.has(t)) names.set(t, kind);
  };
  const lines = run.log.flatMap((l) => [l.text, ...(l.more ?? []).map((m) => m.text)]);
  for (const text of lines) {
    for (const m of text.matchAll(ROOT)) roots.add(m[1].replace(/[\\/]+$/, ""));
    for (const m of text.matchAll(USER)) add(m[1], "user");
    for (const m of text.matchAll(SAVE)) if (!STOCK_SAVES.has(m[1].toLowerCase())) add(m[1], "save");
    for (const m of text.matchAll(CRAFT)) add(m[1], "vessel");
    const v = SWITCH_VESSEL.exec(text);
    if (v) add(v[1], "vessel");
    const c = CREW.exec(text);
    if (c) add(c[1], "kerbal");
    for (const m of text.matchAll(KERMAN)) add(m[1], "kerbal");
  }
  return {
    roots: [...roots].sort((a, b) => b.length - a.length),
    names: [...names].map(([text, kind]) => ({ text, kind })).sort((a, b) => b.text.length - a.text.length),
  };
}
