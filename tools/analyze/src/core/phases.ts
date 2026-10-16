// Coarse Countdown and Hold phases from KSP.log alone, and ModuleManager's
// part of the Countdown (docs/mechanisms.md, 1.1, 3.1, 4.1, 5.3, 6.4).
//
// [C] Each phase ends at a stock, KSPCF or MM line whose place in the
// sequence is fixed by the code:
// - log start: Unity has started KSP; the time before it is not in KSP.log;
// - "Load(Assembly): url", first and last: GameDatabase loads every DLL;
// - the first per-file asset line: before it, in one frame, the Instantly
//   addons' Awake, the config scans and parses (FastLoader's reload too);
// - "Loading Asset Bundle Definitions": the asset loops are done;
// - "GameDatabase: Assets loaded in": asset bundles, configs, resources,
//   traits and upgrades, OnGameDatabaseLoaded;
// - "[ModuleManager] Waited {s}s for patching to finish": PostPatchLoader's
//   wait, which starts {s} before the line;
// - "[ModuleManager] Post patch ran in": the post-patch callbacks;
// - "PartLoader: Compiling Part", first, to the line after the last
//   "Compiling Part" or "Compiling Internal Space": part compilation;
// - "Loading Systems: Elapsed time is": every loading system done; KSP then
//   loads the PSYSTEM scene (the bodies, the PSystemSpawn addons);
// - "Scene Change : From LOADING to MAINMENU": the main menu is requested;
// - "[ModuleManager] Total loading Time": MM's first Update in the main menu,
//   after the menu's addons and objects have started. The menu is ready a
//   little later; KSP.log has no line for that moment.
// A stretch between two named phases (another loading system, a mod's
// loader) is "other loading". A phase whose lines are missing is left out
// and its time joins the next one. Flight entry: the scene request,
// "initializing flight mode" (the scene is loaded), "all systems started"
// (the end of FlightDriver.Start's setup frame), and the ShowUI line (the
// overlay hides after the physics hold).

import { DECIMAL, decimal, type LogLine } from "./log.js";
import type { Run } from "./run.js";

export interface Phase {
  label: string;
  seconds: number;
  /** Mods' code runs in it, so the profiler can name the mods; the log alone cannot. */
  modCode: boolean;
  from: LogLine;
  to: LogLine;
}

export interface MmBreakdown {
  /** MM's Awake to its patching thread's first line: the rest of the first loading frame. */
  startDelay?: number;
  /** The patching thread ("Ran in"). */
  ranIn?: number;
  /** How long the main thread waited for it ("Waited"): MM's cost on the critical path, before post-patch. */
  waited?: number;
  postPatch?: number;
  /** Whether MM loaded its cache. */
  cache?: "used" | "not used";
}

const ASSET_LINE = /^Load(?:\((?:Texture|Model|Audio)\)| (?:[A-Za-z]+ )*?(?:Texture|Model|Audio|texture|model|audio)): /;
const WAITED = new RegExp(String.raw`^\[ModuleManager\] Waited (${DECIMAL})s for patching to finish`);
const POST_PATCH = new RegExp(String.raw`^\[ModuleManager\] Post patch ran in (${DECIMAL})s`);
const RAN_IN = new RegExp(String.raw`^Ran in (${DECIMAL})s`);
const MENU = "Scene Change : From LOADING to MAINMENU";
const OTHER = "Other loading systems (the DLCs' bundles, mods' loaders)";
/** An "other" stretch shorter than this is left out of the table. */
const MIN_OTHER = 0.05;

interface Mark {
  /** The phase that ends here. */
  label: string;
  modCode: boolean;
  line: LogLine;
  /** The time the phase ends, when it is not the line's own (MM's wait starts before its line). */
  t?: number;
}

/** The first line matching, from index `from`; its index too. */
function find(log: LogLine[], test: (l: LogLine) => boolean, from = 0): [LogLine, number] | undefined {
  for (let i = from; i < log.length; i++) if (test(log[i])) return [log[i], i];
  return undefined;
}

function findLast(log: LogLine[], test: (l: LogLine) => boolean, to: number): [LogLine, number] | undefined {
  for (let i = to - 1; i >= 0; i--) if (test(log[i])) return [log[i], i];
  return undefined;
}

/** The Countdown's phases, from KSP.log's start to the main menu; undefined without the main menu's scene change. */
export function countdownPhases(run: Run): Phase[] | undefined {
  const log = run.log;
  const menu = find(log, (l) => l.text.includes(MENU));
  if (!menu || !log.length) return undefined;
  const end = menu[1];
  const marks: Mark[] = [];
  const add = (label: string, modCode: boolean, hit: [LogLine, number] | undefined, t?: number) => {
    if (hit) marks.push({ label, modCode, line: hit[0], ...(t !== undefined ? { t } : {}) });
  };
  const before = (test: (l: LogLine) => boolean) => find(log.slice(0, end), test);

  const firstDll = before((l) => l.text.startsWith("Load(Assembly): "));
  add("KSP start, before the mod DLLs", false, firstDll);
  add("Loading the DLLs", false, findLast(log, (l) => l.text.startsWith("Load(Assembly): "), end));
  add("Instantly addons' Awake and the config scans", true, before((l) => ASSET_LINE.test(l.text)));
  add("Assets: audio, textures, models", true, before((l) => l.text === "Loading Asset Bundle Definitions"));
  add("Asset bundles, configs, resources, upgrades", true, before((l) => l.text.startsWith("GameDatabase: Assets loaded in")));
  const waited = before((l) => WAITED.test(l.text));
  if (waited) {
    const seconds = decimal(WAITED.exec(waited[0].text)![1]);
    // The wait itself; the stretch before it is other loading systems.
    marks.push({ label: "(wait start)", modCode: true, line: waited[0], t: waited[0].t - seconds });
    add("Waiting for ModuleManager's patching", false, waited);
  }
  add("ModuleManager's post-patch callbacks", true, before((l) => POST_PATCH.test(l.text)));
  const firstPart = before((l) => l.text.startsWith("PartLoader: Compiling Part "));
  if (firstPart) {
    marks.push({ label: "(parts start)", modCode: true, line: firstPart[0] });
    const last = findLast(log, (l) => l.text.startsWith("PartLoader: Compiling Part ") || l.text.startsWith("PartLoader: Compiling Internal "), end)!;
    // A part's work ends at the next line.
    add("Part compilation", true, last[1] + 1 < end ? [log[last[1] + 1], last[1] + 1] : last);
  }
  add(OTHER, true, before((l) => l.text.startsWith("Loading Systems: Elapsed time is")));
  add("Planetary system scene (bodies, PSystemSpawn addons)", true, menu);
  add("Main menu scene, to its first frame", true, find(log, (l) => l.text.startsWith("[ModuleManager] Total loading Time = "), end));

  // Marks in time order; one out of order means a line this code did not expect: leave it out.
  const phases: Phase[] = [];
  let from = log[0];
  let fromT = log[0].t;
  for (const m of marks) {
    const t = m.t ?? m.line.t;
    if (t < fromT) continue;
    // A stretch before a phase that starts at a mark of its own.
    if (m.label === "(wait start)" || m.label === "(parts start)") {
      if (t - fromT > 0) phases.push({ label: OTHER, seconds: t - fromT, modCode: true, from, to: m.line });
    } else phases.push({ label: m.label, seconds: t - fromT, modCode: m.modCode, from, to: m.line });
    from = m.line;
    fromT = t;
  }
  return merge(phases);
}

/** Adjacent "other" stretches as one; short ones left out. */
function merge(phases: Phase[]): Phase[] {
  const out: Phase[] = [];
  for (const p of phases) {
    const prev = out[out.length - 1];
    if (prev && prev.label === OTHER && p.label === OTHER) {
      prev.seconds += p.seconds;
      prev.to = p.to;
    } else out.push({ ...p });
  }
  return out.filter((p) => p.label !== OTHER || p.seconds >= MIN_OTHER);
}

/** ModuleManager's part of the Countdown; undefined when MM is not installed or the log has no MM lines. */
export function mmBreakdown(run: Run): MmBreakdown | undefined {
  const menu = run.log.findIndex((l) => l.text.includes(MENU));
  const log = menu < 0 ? run.log : run.log.slice(0, menu);
  const started = log.find((l) => l.text.startsWith("[ModuleManager] Patching started on a new thread"));
  const waited = log.find((l) => WAITED.test(l.text));
  const post = log.find((l) => POST_PATCH.test(l.text));
  if (!started && !waited && !post) return undefined;
  const dump = run.mmDumps[0]?.lines ?? [];
  // [C] MM logs "useCache = True" only when it loads its cache; a whole dump without it patched from scratch.
  const cacheUsed = dump.some((l) => l.text === "useCache = True");
  const cacheKnown = cacheUsed || run.mmDumps[0]?.complete === true;
  const checking = dump.find((l) => l.text === "Checking Cache");
  const ranIn = dump.find((l) => RAN_IN.test(l.text));
  return {
    ...(started && checking && checking.t >= started.t ? { startDelay: checking.t - started.t } : {}),
    ...(ranIn ? { ranIn: decimal(RAN_IN.exec(ranIn.text)![1]) } : {}),
    ...(waited ? { waited: decimal(WAITED.exec(waited.text)![1]) } : {}),
    ...(post ? { postPatch: decimal(POST_PATCH.exec(post.text)![1]) } : {}),
    ...(cacheKnown ? { cache: cacheUsed ? "used" : "not used" } : {}),
  };
}

export interface FlightEntry {
  /** The Hold's label, "FROM->FLIGHT". */
  label: string;
  phases: Phase[];
}

/** Each flight entry's phases from KSP.log: the scene load, the setup frame, the frames up to the overlay's end. */
export function flightEntries(run: Run): FlightEntry[] {
  const log = run.log;
  const result: FlightEntry[] = [];
  for (let i = 0; i < log.length; i++) {
    const m = /Scene Change : From (\w+) to FLIGHT/.exec(log[i].text);
    if (!m) continue;
    const request = log[i];
    // This Hold's lines: up to the next scene change.
    let j = i + 1;
    while (j < log.length && !log[j].text.includes("Scene Change : From ")) j++;
    const hold = log.slice(i + 1, j);
    const init = hold.findIndex((l) => l.text.startsWith("------------------- initializing flight mode..."));
    const started = hold.findIndex((l, k) => k > init && l.text === "all systems started");
    const shown = hold.findIndex((l, k) => k > started && l.text.includes("[UIMasterController]: ShowUI"));
    if (init < 0 || started < 0 || shown < 0) continue;
    const [a, b, c] = [hold[init], hold[started], hold[shown]];
    const buffered = request.text.includes("(Async)");
    result.push({
      label: `${m[1]}->FLIGHT`,
      phases: [
        { label: buffered ? "Scene load, with the buffered switch's empty scene" : "Scene load", seconds: a.t - request.t, modCode: true, from: request, to: a },
        { label: "Setup frame: save, vessels, the active vessel's parts, terrain", seconds: b.t - a.t, modCode: true, from: a, to: b },
        { label: "Parts' Start and the physics hold, to the overlay's end", seconds: c.t - b.t, modCode: true, from: b, to: c },
      ],
    });
  }
  return result;
}
