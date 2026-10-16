// Redaction of what identifies the player, the machine's accounts, the install
// or the save (docs/m6-web-plan.md, decision 7). Paths keep their part from
// GameData on; every other path, user, save, vessel and Kerbal name, and
// Steam id is replaced. Hardware names stay: they are in RunAnalysis.system,
// never redacted.

import type { Identifying } from "../core/identity.js";

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** A literal that matches with either slash. */
const slashes = (s: string) => escape(s).replace(/\\\\|\//g, String.raw`[\\/]`);

const PLACEHOLDER = { user: "<user>", save: "<save>", vessel: "<vessel>", kerbal: "<Kerbal>" } as const;

/** A remaining absolute path, up to a quote or a space. */
const ABSOLUTE_PATH = /(?<![\w.])(?:[A-Za-z]:[\\/]|\\\\[^\\/\s]+[\\/]|\/(?:home|Users|mnt|media|Volumes|opt|usr|var|tmp|private|run|srv)\/)[^\s'"<>|]*/g;
/** Steam64 ids. */
const STEAM_ID = /\b7656119\d{10}\b/g;
/** A path's part from GameData on, after any absolute prefix the roots missed. */
const TO_GAMEDATA = /(?<![\w.])(?:[A-Za-z]:[\\/]|\/)[^\s'"<>|]*?[\\/]GameData(?=[\\/])/g;

export type Redact = (text: string) => string;

/** A redactor for one run's identifiers. */
export function redactor(id: Identifying): Redact {
  const roots = id.roots.map((r) => ({
    gameData: new RegExp(`${slashes(r)}[\\\\/]+(?:[^\\\\/'"\\n]*_Data[\\\\/]+\\.\\.[\\\\/]+)?GameData(?=[\\\\/'"\\s]|$)`, "g"),
    rest: new RegExp(slashes(r), "g"),
  }));
  const names = id.names.map((n) => ({ re: new RegExp(`(?<![\\w'<-])${escape(n.text)}(?![\\w>-])`, "g"), to: PLACEHOLDER[n.kind] }));
  return (text) => {
    let s = text;
    for (const r of roots) s = s.replace(r.gameData, "GameData").replace(r.rest, "<KSP>");
    s = s.replace(TO_GAMEDATA, "GameData");
    for (const n of names) s = s.replace(n.re, n.to);
    return s.replace(ABSOLUTE_PATH, "<path>").replace(STEAM_ID, "<id>");
  };
}
