// The mods installed in a run, from KSP.log itself, and which of them wrote a log line.
//
// Built only from the run's "Load(Assembly): <folder>/.../<assembly>" lines:
// no curated list. A log source that matches no assembly (stock code, Unity,
// a tag the mod chose freely) stays unattributed.

import type { ModRef } from "./findings/types.js";
import type { Run } from "./run.js";

export interface Mod {
  /** Assembly name, e.g. "ProgressiveCBMaps". */
  assembly: string;
  /** First folder under GameData, e.g. "REPOSoftTech". */
  folder: string;
  /** How the report names it: the assembly, with its folder when that differs. */
  name: string;
}

/** GameData folders that ship stock KSP and its expansions. */
export const STOCK_FOLDERS: ReadonlySet<string> = new Set(["Squad", "SquadExpansion"]);
/**
 * Folders whose work is not mod work: stock, T-Minus itself (old name
 * included), and its dev-only route driver (automated validation runs).
 */
const NOT_MODS = new Set([...STOCK_FOLDERS, "000_TMinus", "000_HyperLoad", "TMinusRoute"]);

/** Whether a GameData folder is a mod's, not stock KSP's or T-Minus' own. */
export const isModFolder = (folder: string) => !NOT_MODS.has(folder);
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

/** The installed mods (stock and T-Minus excluded), from the "Load(Assembly)" lines. */
export function installedMods(run: Run): Mod[] {
  return installed(run).map((m) => m.mod);
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

/**
 * The GameData folder a URL or path lives in: its first folder, the mod that
 * ships it. Accepts "Mod/Parts/x", "GameData/Mod/x" and Windows separators.
 */
export function folderOfUrl(url: string): string {
  const parts = url.replace(/\\/g, "/").split("/").filter(Boolean);
  const i = parts.findIndex((p) => p.toLowerCase() === "gamedata");
  return parts[i + 1] ?? parts[0] ?? "";
}

/**
 * The installed mod an assembly belongs to (the profiler names types as
 * "<assembly>/<type>"), from the run's "Load(Assembly)" lines. Undefined for
 * stock, T-Minus, and assemblies the log does not list.
 */
export function modOfAssembly(run: Run, assembly: string): Mod | undefined {
  const key = norm(assembly);
  return key ? installed(run).find((m) => m.key === key)?.mod : undefined;
}

/**
 * The game's own assemblies, in KSP_x64_Data/Managed: KSP's (the expansions'
 * code is in Assembly-CSharp too), Unity's and Mono's. KSP.log never lists
 * them as "Load(Assembly)", which only covers GameData.
 */
const STOCK_ASSEMBLY = /^(Assembly-CSharp(-firstpass)?|KSPAssets(\..+)?|KSPTrackIR|TDx\..+|Ionic\.Zip|I18N(\..+)?|UnityEngine(\..+)?|Unity\..+|mscorlib|System(\..+)?|Mono\..+)$/;

/** Whether an assembly is the game's own (see STOCK_ASSEMBLY). */
export const isStockAssembly = (assembly: string) => STOCK_ASSEMBLY.test(assembly);

/** A profiler key "<assembly>/<rest>" (types, Harmony owners), split at its first "/"; no "/" means no assembly. */
export function splitAssemblyKey(key: string): { assembly?: string; rest: string } {
  const slash = key.indexOf("/");
  return slash > 0 ? { assembly: key.slice(0, slash), rest: key.slice(slash + 1) } : { rest: key };
}

/** T-Minus' own assemblies (old name included) and its dev-only route driver. */
const TMINUS_ASSEMBLY = /^(TMinus|TMinusRoute|HyperLoad)$/;

/**
 * Who an assembly from a profiler key belongs to, as the report names it: its
 * mod (by GameData folder) when KSP.log lists the assembly, else the assembly.
 */
export function assemblyOwner(run: Run, assembly: string): { name: string; mod?: Mod; stock: boolean; tminus: boolean } {
  const mod = modOfAssembly(run, assembly);
  const stock = !mod && isStockAssembly(assembly);
  return { name: stock ? "stock KSP" : mod?.name ?? assembly, mod, stock, tminus: TMINUS_ASSEMBLY.test(assembly) };
}

/** A finding's reference to an installed mod, by assembly name (findings/types.ts). */
export const modRef = (mod: Mod, role: ModRef["role"]): ModRef => ({ name: mod.assembly, folder: mod.folder, role });

/** A finding's reference to the mod that ships a GameData folder; undefined for stock and T-Minus folders. */
export const folderRef = (folder: string, role: ModRef["role"]): ModRef | undefined =>
  folder && isModFolder(folder) ? { name: folder, folder, role } : undefined;

/**
 * A finding's reference to the mod an assembly from a profiler key belongs
 * to: by its folder when KSP.log lists it, else the bare assembly name.
 * Undefined for stock KSP and T-Minus.
 */
export function assemblyRef(run: Run, assembly: string, role: ModRef["role"]): ModRef | undefined {
  const owner = assemblyOwner(run, assembly);
  if (owner.stock || owner.tminus) return undefined;
  return owner.mod ? modRef(owner.mod, role) : { name: assembly, role };
}

/** The role of each of n mods named for one cost: alone it is the culprit, together they share it. */
export const sharedRole = (n: number): ModRef["role"] => (n === 1 ? "culprit" : "shared");
