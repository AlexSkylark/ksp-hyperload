// KSPCommunityFixes' PNG texture cache: off, or rebuilt this startup.
//
// [C] With FastLoader, KSPCF can convert PNG textures to DXT5 once and keep
// them in a cache, an opt-in the player chooses in a dialog on the first
// startup (PluginData/PNGTextureCache.cfg, textureCacheEnabled). Its loader
// logs "Load Cached PNG Texture: url" for a cache hit and "Load PNG texture:
// url" otherwise; a PNG it converts and stores is followed by "[KSPCF] PNG
// texture 'url' was converted to DXT5 and has been cached for future
// reloads". A PNG whose size is not a multiple of 4 gets the warning "Texture
// isn't eligible for DXT compression..." and is never cached. KSPCF deletes
// the whole cache, without a log line, when its progress marker shows the
// previous loading did not finish (a crash or a kill during loading) or the
// cache version changed (docs/mechanisms.md, 4.4).
//
// Cost: the files' load times from KSP.log's stamps (assets.ts). A cached
// load is not free, so the time is an upper bound on what the cache saves.

import { assetLoads, type AssetFile } from "../assets.js";
import type { LogLine } from "../log.js";
import type { Run } from "../run.js";
import type { Evidence, Facts, Finding, ModRef, Rule } from "./types.js";

/** The setting is KSPCommunityFixes' own. */
const KSPCF: ModRef = { name: "KSPCommunityFixes", folder: "KSPCommunityFixes", role: "culprit" };

const MIN_SECONDS = 1;
const PNG_LOAD = /^Load PNG texture: (.+)$/;
const CACHED_LOAD = /^Load Cached PNG Texture: /;
const CONVERTED = /^\[KSPCF\] PNG texture '(.+)' was converted to DXT5 and has been cached/;
const NOT_ELIGIBLE = "Texture isn't eligible for DXT compression";

interface PngLoads {
  hits: LogLine[];
  /** PNG files loaded without the cache, eligible for it. */
  eligible: LogLine[];
  notEligible: number;
  converted: LogLine[];
  /** Load time per url, from the asset timeline. */
  seconds: Map<string, AssetFile>;
}

function pngLoads(run: Run): PngLoads | undefined {
  const assets = assetLoads(run);
  if (assets?.loader !== "FastLoader") return undefined;
  const end = run.log.findIndex((l) => l.text.includes("Scene Change : From LOADING to MAINMENU"));
  const log = end < 0 ? run.log : run.log.slice(0, end);
  const out: PngLoads = { hits: [], eligible: [], notEligible: 0, converted: [], seconds: new Map(assets.files.map((f) => [f.url, f])) };
  let open: LogLine | undefined;
  let eligible = true;
  const close = () => {
    if (open && eligible) out.eligible.push(open);
    else if (open) out.notEligible++;
    open = undefined;
  };
  for (const l of log) {
    if (CACHED_LOAD.test(l.text)) out.hits.push(l);
    if (CONVERTED.test(l.text)) out.converted.push(l);
    // The warning comes with the file being loaded; any other asset line ends that file.
    if (l.text.includes(NOT_ELIGIBLE)) eligible = false;
    else if (l.text.startsWith("Load ")) {
      close();
      if (PNG_LOAD.test(l.text)) {
        open = l;
        eligible = true;
      }
    }
  }
  close();
  return out;
}

const timeOf = (p: PngLoads, url: string) => p.seconds.get(url)?.seconds ?? 0;
const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);
const lineEvidence = (l: LogLine): Evidence => ({ source: "log", line: l.n, text: l.text });

export const kspcfTextureCacheOff: Rule = {
  id: "kspcf-texture-cache-off",
  needs: "log",
  detects: "KSPCommunityFixes' PNG texture cache turned off",
  run(run: Run, facts: Facts): Finding[] {
    const p = pngLoads(run);
    if (!p) return [];
    const recorded = facts.install?.kspcfTextureCache;
    // With the cache on, an eligible PNG is either a hit or converted and stored.
    if (recorded === true || p.hits.length || p.converted.length) return [];
    const seconds = sum(p.eligible.map((l) => timeOf(p, PNG_LOAD.exec(l.text)![1])));
    if (seconds < MIN_SECONDS) return [];

    const evidence: Evidence[] = [];
    if (recorded === false) evidence.push({ source: "profiler", text: "KSPCommunityFixes' textureCacheEnabled: false" });
    evidence.push(...p.eligible.slice(0, 3).map(lineEvidence));
    return [
      {
        id: this.id,
        title: `KSPCommunityFixes' PNG texture cache is off: ${p.eligible.length} PNG textures decoded on every startup`,
        subject: "KSPCommunityFixes",
        mods: [KSPCF],
        where: { phase: "countdown" },
        cost: {
          kind: "estimated",
          seconds,
          method: "load time of the PNG files the cache could hold, from KSP.log's stamps; a cached load still costs some of it, so this is an upper bound on the saving",
        },
        evidence,
        action:
          "Turn the cache on: set textureCacheEnabled = true in GameData/KSPCommunityFixes/PluginData/PNGTextureCache.cfg (or delete that file to get KSPCommunityFixes' opt-in dialog again). The first startup after that converts the textures; later ones load them from the cache.",
        cause: "PNG textures decoded without KSPCommunityFixes' cache",
        remedy: "fix",
        confidence: recorded === false ? "measured" : "heuristic",
        notes: [
          ...(p.notEligible ? [`${p.notEligible} other PNG files are not eligible for the cache (their size is not a multiple of 4).`] : []),
          ...(recorded === undefined ? ["KSP.log does not show the setting; no cache hit and no conversion this startup is the cache's signature when it is off."] : []),
        ],
      },
    ];
  },
};

export const kspcfTextureCacheRebuilt: Rule = {
  id: "kspcf-texture-cache-rebuilt",
  needs: "log",
  detects: "KSPCommunityFixes' PNG texture cache rebuilt this startup",
  run(run: Run): Finding[] {
    const p = pngLoads(run);
    if (!p?.converted.length) return [];
    const seconds = sum(p.converted.map((l) => timeOf(p, CONVERTED.exec(l.text)![1])));
    if (seconds < MIN_SECONDS) return [];
    const whole = p.hits.length === 0;

    return [
      {
        id: this.id,
        title: whole
          ? `KSPCommunityFixes rebuilt its PNG texture cache: ${p.converted.length} textures converted`
          : `KSPCommunityFixes added ${p.converted.length} textures to its PNG texture cache (${p.hits.length} loaded from it)`,
        subject: "KSPCommunityFixes",
        mods: [KSPCF],
        where: { phase: "countdown" },
        cost: {
          kind: "estimated",
          seconds,
          method: "load time of the converted files, from KSP.log's stamps: decoding, conversion and the cache write; a cached load later still costs some of it",
        },
        evidence: [p.converted[0], p.converted[p.converted.length - 1]].filter((l, i, a) => a.indexOf(l) === i).map(lineEvidence),
        action: whole
          ? "Nothing to do if this is the first startup since KSPCommunityFixes was installed, updated or its cache turned on: the next startup loads the textures from the cache. If every startup rebuilds it, KSP is likely crashing or being closed during loading (KSPCommunityFixes then deletes the cache); find that crash."
          : "Nothing to do if mods were added or updated since the last startup: their textures are cached now. If the same textures are converted on every startup, check that GameData/KSPCommunityFixes is writable.",
        cause: "KSPCommunityFixes' texture cache conversion",
        remedy: "none",
        confidence: "measured",
        informational: true,
      },
    ];
  },
};
