// Per-file asset loading in the Countdown, from KSP.log's own per-file lines
// (docs/mechanisms.md, 4.3). No profiler data: works on any KSP.log.
//
// [C] Stock GameDatabase logs "Load(Texture|Model|Audio): <url>" (with
// " OUT OF DATE" when the file changed) before loading each file, one at a
// time on the main thread. KSPCF's FastLoader logs "Load <TypeName>: <url>"
// right before decoding each file on the main thread ("DDS texture",
// "MU model", ...), and "Load Texture|Model|Audio: <url>" for files it hands
// to other mods' loaders. Its audio clips load up to 25 at a time, so the
// time after one "Load Audio" line is the main thread's wait, not that
// file's cost.
//
// A file's time runs from its line to the next asset line, or to the first
// other LOG-level line (the end of the asset phase). Warnings and errors in
// between are about the file being loaded and do not end it. The result is
// inferred from log timestamps (ms): a frame boundary inside a file's time
// counts toward that file.

import { DECIMAL, decimal, type LogLine } from "./log.js";
import { folderOfUrl } from "./mods.js";
import type { Run } from "./run.js";

export type AssetKind = "texture" | "model" | "audio";

export interface AssetFile {
  url: string;
  /** GameData folder: the mod that ships the file. */
  folder: string;
  kind: AssetKind;
  /** The loader's own name for the format: "Texture" (stock), "DDS texture", "MU model", ... */
  format: string;
  line: LogLine;
  seconds: number;
}

export interface AssetGroup {
  key: string;
  files: number;
  seconds: number;
}

export interface AssetLoads {
  /** Which code wrote the lines: stock GameDatabase, or KSPCF's FastLoader. */
  loader: "stock" | "FastLoader";
  /** Every file, in log order. */
  files: AssetFile[];
  /** Sum over files whose time is their own (concurrent audio left out). */
  seconds: number;
  /** FastLoader only: audio clips load concurrently, so their time is not per file and is left out of the groups. */
  concurrentAudio?: { files: number; seconds: number };
  /** Largest first; concurrent audio left out. */
  byFolder: AssetGroup[];
  byFormat: AssetGroup[];
  /** FastLoader's own report ("N assets loaded in X s"), when the log has it: a cross-check for the sum. */
  reported?: { files: number; seconds: number; line: LogLine };
}

const STOCK = /^Load\((Texture|Model|Audio)\): (.+?)(?: OUT OF DATE)?$/;
/** FastLoader's form. The type name is one or more words, the last of which says the kind. */
const FAST = /^Load ((?:[A-Za-z]+ )*?(Texture|Model|Audio|texture|model|audio)): (.+)$/;
const REPORTED = new RegExp(String.raw`^- (\d+) assets loaded in (${DECIMAL})s`);

interface Parsed {
  form: "stock" | "fast";
  format: string;
  kind: AssetKind;
  url: string;
}

function parseAssetLine(text: string): Parsed | undefined {
  let m = STOCK.exec(text);
  if (m) return { form: "stock", format: m[1], kind: m[1].toLowerCase() as AssetKind, url: m[2] };
  m = FAST.exec(text);
  if (m) return { form: "fast", format: m[1], kind: m[2].toLowerCase() as AssetKind, url: m[3] };
  return undefined;
}

function group(files: AssetFile[], key: (f: AssetFile) => string): AssetGroup[] {
  const groups = new Map<string, AssetGroup>();
  for (const f of files) {
    const k = key(f);
    const g = groups.get(k) ?? { key: k, files: 0, seconds: 0 };
    g.files++;
    g.seconds += f.seconds;
    groups.set(k, g);
  }
  return [...groups.values()].sort((a, b) => b.seconds - a.seconds);
}

/** The Countdown's per-file asset loads; undefined when the log has no per-file line. */
export function assetLoads(run: Run): AssetLoads | undefined {
  // Only the Countdown: a database reload later (ModuleManager's menu) is not startup.
  const end = run.log.findIndex((l) => l.text.includes("Scene Change : From LOADING to MAINMENU"));
  const log = end < 0 ? run.log : run.log.slice(0, end);

  const files: AssetFile[] = [];
  let fast = false;
  let open: { parsed: Parsed; line: LogLine } | undefined;
  const close = (t: number) => {
    if (!open) return;
    const { parsed, line } = open;
    files.push({ url: parsed.url, folder: folderOfUrl(parsed.url), kind: parsed.kind, format: parsed.format, line, seconds: Math.max(0, t - line.t) });
    open = undefined;
  };
  for (const l of log) {
    const parsed = parseAssetLine(l.text);
    if (parsed) {
      close(l.t);
      if (parsed.form === "fast") fast = true;
      open = { parsed, line: l };
    } else if (l.level === "LOG") close(l.t);
  }
  // The log ended inside the asset phase: the last file's time is unknown.
  if (open) files.push({ url: open.parsed.url, folder: folderOfUrl(open.parsed.url), kind: open.parsed.kind, format: open.parsed.format, line: open.line, seconds: 0 });
  if (!files.length) return undefined;

  const concurrent = fast ? files.filter((f) => f.kind === "audio") : [];
  const own = fast ? files.filter((f) => f.kind !== "audio") : files;

  // The report comes at the end of loading; look at the whole log.
  let reported: AssetLoads["reported"];
  for (const l of run.log) {
    if (!l.text.startsWith("[KSPCF:FastLoader]")) continue;
    for (const m of l.more ?? []) {
      const r = REPORTED.exec(m.text.trim());
      if (r) reported = { files: Number(r[1]), seconds: decimal(r[2]), line: l };
    }
  }

  return {
    loader: fast ? "FastLoader" : "stock",
    files,
    seconds: own.reduce((s, f) => s + f.seconds, 0),
    ...(fast ? { concurrentAudio: { files: concurrent.length, seconds: concurrent.reduce((s, f) => s + f.seconds, 0) } } : {}),
    byFolder: group(own, (f) => f.folder),
    byFormat: group(own, (f) => f.format),
    ...(reported ? { reported } : {}),
  };
}
