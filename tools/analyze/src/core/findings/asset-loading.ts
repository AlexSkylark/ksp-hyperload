// A mod whose textures and models take long to load in the Countdown.
//
// [C] Assets load one file at a time on the main thread, stock or with
// KSPCF's FastLoader, and both log a line per file (docs/mechanisms.md, 4.3).
// core/assets.ts gives each file the time from its line to the next and
// groups it by GameData folder: the mod that ships the file. That time also
// holds a yielded frame now and then and any wait for FastLoader's reader
// thread, so it is an upper bound per folder, close in total. FastLoader's
// audio loads concurrently and is not split per folder.
//
// Informational (4.3, player action): the cost is the mod's content, not a
// setting the player can change.

import { isModFolder } from "../mods.js";
import type { Run } from "../run.js";
import type { Evidence, Facts, Finding, Rule } from "./types.js";

/** A folder needs at least this much asset time. Provisional (step 9). */
const MIN_SECONDS = 1;
/** Slowest files shown per folder. */
const EVIDENCE_FILES = 5;
/** FastLoader formats decoded and compressed on the main thread, where DDS is read as is (4.3). Stock lines do not name the format. */
const DECODED = /^(PNG|JPG) texture$/;

export const assetLoadingByMod: Rule = {
  id: "asset-loading-by-mod",
  needs: "log",
  detects: "mods whose textures and models take long to load",
  run(_run: Run, facts: Facts): Finding[] {
    const assets = facts.countdown.assets;
    if (!assets) return [];
    const concurrent = (f: { kind: string }) => assets.concurrentAudio !== undefined && f.kind === "audio";

    return assets.byFolder
      .filter((g) => isModFolder(g.key) && g.seconds >= MIN_SECONDS)
      .map((g): Finding => {
        const files = assets.files.filter((f) => f.folder === g.key && !concurrent(f));
        const evidence: Evidence[] = [...files]
          .sort((a, b) => b.seconds - a.seconds)
          .slice(0, EVIDENCE_FILES)
          .map((f) => ({ source: "log", line: f.line.n, text: `${f.line.text} (${f.seconds.toFixed(3)} s to the next line)` }));
        const byFormat = new Map<string, { files: number; seconds: number }>();
        for (const f of files) {
          const e = byFormat.get(f.format) ?? { files: 0, seconds: 0 };
          e.files++;
          e.seconds += f.seconds;
          byFormat.set(f.format, e);
        }
        const formats = [...byFormat].sort((a, b) => b[1].seconds - a[1].seconds);
        const notes = [`By format: ${formats.map(([k, e]) => `${k} ${e.files} files, ${e.seconds.toFixed(1)} s`).join("; ")}.`];
        if (assets.concurrentAudio?.files) notes.push("FastLoader loads audio concurrently, so this folder's audio is not counted.");
        const decoded = formats.filter(([k]) => DECODED.test(k)).reduce((s, [, e]) => s + e.seconds, 0);
        if (decoded >= MIN_SECONDS / 2)
          notes.push(`${decoded.toFixed(1)} s is PNG or JPG textures, which are decoded and compressed on the main thread; DDS textures are read as they are.`);
        return {
          id: this.id,
          title: `Asset loading: ${g.key} takes ${g.seconds.toFixed(1)} s of the Countdown (${g.files} files)`,
          subject: g.key,
          where: { phase: "countdown" },
          cost: { kind: "estimated", seconds: g.seconds, method: "upper bound: sum of the time from each of the folder's \"Load\" lines to the next line" },
          evidence,
          action: `This is the cost of ${g.key}'s textures and models, paid on every startup; it grows with their number and size. Nothing to change on your side. If it stands out, ${g.key}'s authors can be told which files are slowest.`,
          confidence: "heuristic",
          informational: true,
          notes,
        };
      });
  },
};
