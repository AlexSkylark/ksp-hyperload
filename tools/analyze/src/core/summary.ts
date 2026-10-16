// Parser for the profiler's summary in KSP.log (src/TMinus/Profiler/LogSummary.cs).
//
// At the end of the Countdown and of each Hold the profiler writes a block:
//
//   [TMinus] Summary (format 2): Countdown ready at 261.930 s (main menu scene 57.28 s), this line at 261.950 s after process start
//   [TMinus] Summary: GC incremental yes, mode Enabled                       (Countdown only, format 2)
//   [TMinus] Summary: KSPCF settings nodes 2                                 (Countdown only, format 2, when not 1)
//   [TMinus] Summary: KSPCF setting ForceSyncSceneSwitch: true -> false      (Countdown only, format 2)
//   [TMinus] Summary (format 2): Hold EDITOR->FLIGHT 37.27 s, ready at 377.233 s, this line at 377.251 s after process start
//   [TMinus] Summary: long frame MAINMENU at 204.644 s, 48.000 s, 3 GC, covered 1.250 s, runs 210.100+0.900:0.880   (", n GC" from format 2, covered from 3, runs from 4: start+length:time inside hooks)
//   [TMinus] Summary: switch buffered steps 0.412 s in 2, overlay after GUI ready 2.723 s   (Holds, format 2)
//   [TMinus] Summary: addon Awake Kopernicus/Kopernicus.Injector 4580 ms, 1 call
//   [TMinus] Summary: parts (other 30) 5120 ms, 412 parts
//   [TMinus] Summary: scenario Assembly-CSharp/ResearchAndDevelopment 120 ms, 1 module   (format 2; the assembly from 3)
//   [TMinus] Summary: terrain Kerbin 850 ms, 1 start                          (format 2)
//   [TMinus] Summary: module RSE/RocketSoundEnhancement.RSE_Engines 310 ms, 714 calls   (format 3: all module stages)
//   [TMinus] Summary: modules RSE 480 ms, 2210 calls                         (format 3: the same, per assembly)
//   [TMinus] Summary: coroutine Scatterer/Scatterer.Core+<Init>d__4 900 ms, 120 steps   (format 5, opt-in coroutine timing)
//   [TMinus] Summary: coroutines Scatterer 1300 ms, 410 steps                (format 5: the same, per assembly)
//   [TMinus] Summary: harmony patch KSPCommunityFixes/KSPCommunityFixes 1520 ms, 610 patches   (format 3)
//   [TMinus] Summary: harmony unpatch KSPCommunityFixes/KSPCommunityFixes 12 ms, 10 unpatches  (format 3)
//   [TMinus] Summary: patch call calibration 50.0 ns, body 24.0 ns per call    (format 3, opt-in brackets)
//   [TMinus] Summary: patch calls bracketed 199, skipped 181 (own=11,transpiler-only=170)   (format 3)
//   [TMinus] Summary: patch call Assembly-CSharp/PQS.BuildTangents 28 ms, 1875 calls, body 310 ms, by KSPCommunityFixes/KSPCommunityFixes   (format 3)
//   [TMinus] Summary: addon memory ProgressiveCBMaps/ProgressiveCBMaps.VisualMaps +1900 MB   (format 2)
//   [TMinus] Summary: memory managed 1792 MB, heap 1971 MB, unity 8904 MB, 704 GC            (format 2)
//   [TMinus] Summary: end | 1 long frame 48.0 s, addon Awake 7.2 s, parts 34.2 s
//
// The blocks become the same records the .jsonl holds (scene transitions,
// long frames, checkpoints, aggregates, counters, memory), so every rule reads
// them unchanged. Facts the .jsonl keeps in its "run" and "conditions" records
// become one "facts" record instead, so a partial header is never mistaken for
// the .jsonl's. Times are seconds since process start.

import type { LogLine } from "./log.js";
import type { ProfilerRecord } from "./profiler.js";

export interface Summary {
  records: ProfilerRecord[];
  /** KSP.log time (s) of process start, from the first block's own time. */
  processStartLogT: number;
  /** The highest format number among the blocks. */
  format: number;
}

const MB = 1024 * 1024;

const OPEN = /^\[TMinus\] Summary \(format [1-5]\): (?:Countdown ready at ([\d.]+) s \(main menu scene ([\d.]+) s\)|Hold (\S+) ([\d.]+) s, ready at ([\d.]+) s), this line at ([\d.]+) s after process start$/;
const FRAME = /^\[TMinus\] Summary: long frame (\S+) at ([\d.]+) s, ([\d.]+) s(?:, (\d+) GC)?(?:, covered ([\d.]+) s)?(?:, runs ([\d.+: ]+))?$/;
const RUN = /^([\d.]+)\+([\d.]+):([\d.]+)$/;
const AGGREGATE = /^\[TMinus\] Summary: (addon Awake|addon Start|coroutines|coroutine|parts|scenario|terrain|modules|module|harmony patch|harmony unpatch) (.+) (\d+) ms, (\d+) (?:calls?|parts?|modules?|starts?|steps?|patch(?:es)?|unpatch(?:es)?)$/;
const PATCH_CALL = /^\[TMinus\] Summary: patch call (.+?) (\d+) ms, (\d+) calls?, body (\d+) ms(?:, by (.+))?$/;
const CALIBRATION = /^\[TMinus\] Summary: patch call calibration ([\d.]+) ns, body ([\d.]+) ns per call$/;
const BRACKETED = /^\[TMinus\] Summary: patch calls bracketed (\d+), skipped (\d+)(?: \((.*)\))?$/;
const SWITCH = /^\[TMinus\] Summary: switch buffered steps ([\d.]+) s in (\d+), overlay after GUI ready ([\d.]+) s$/;
const ADDON_MEMORY = /^\[TMinus\] Summary: addon memory (.+) \+(\d+) MB$/;
const MEMORY = /^\[TMinus\] Summary: memory managed (\d+) MB, heap (\d+) MB, unity (\d+) MB, (\d+) GC$/;
const GC_MODE = /^\[TMinus\] Summary: GC incremental (yes|no|unknown), mode (\S+)$/;
const KSPCF_NODES = /^\[TMinus\] Summary: KSPCF settings nodes (\d+)$/;
const KSPCF_SETTING = /^\[TMinus\] Summary: KSPCF setting (.+)$/;

const FAMILIES: Record<string, string> = {
  "addon Awake": "addon.awake",
  "addon Start": "addon.start",
  // Steps no other timed call encloses (format 5), per type and per assembly.
  coroutine: "coroutine.step",
  coroutines: "coroutine.byAssembly",
  parts: "part.parse.byMod",
  scenario: "scenario.load",
  terrain: "pqs.forceStart",
  // The .jsonl has a family per module stage; the summary sums them.
  module: "module.byType",
  modules: "module.byAssembly",
  "harmony patch": "harmony.patch",
  "harmony unpatch": "harmony.unpatch",
};

// The profiler's older main menu line also lists the loaders, to 0.1 s:
//   [TMinus] Profiler: main menu ready 57.3 s after process start | loaders: GameDatabase >=16.7 s~, PartLoader 4.0 s (~ = ...)
// ">=" (started before T-Minus) and "~" (accurate to a frame) both mean approximate.
const LOADERS = /^\[TMinus\] Profiler: main menu ready [\d.]+ s after process start \| loaders: (.*) \(~ = /;
const LOADER = /^(.+) (>=)?([\d.]+) s(~)?$/;

function loaders(log: LogLine[]): ProfilerRecord[] {
  for (const l of log) {
    const m = LOADERS.exec(l.text);
    if (!m) continue;
    return m[1].split(", ").flatMap((item) => {
      const x = LOADER.exec(item);
      return x ? [{ t: 0, kind: "span", name: "loader", detail: x[1], dur: Number(x[3]) * 1000, approx: Boolean(x[2] || x[4]) }] : [];
    });
  }
  return [];
}

/** The summary blocks in a KSP.log, or undefined when there are none. */
/** The format the profiler writes now (LogSummary.Format): older ones lack lines the rules read. */
export const SUMMARY_FORMAT = 5;

export function parseSummary(log: LogLine[]): Summary | undefined {
  const records: ProfilerRecord[] = [];
  let processStartLogT: number | undefined;
  let format = 0;
  let block: { t: number; start: number; label: string } | undefined;
  let facts: ProfilerRecord | undefined;
  // Format 2 counts collections per block; the .jsonl's memory records carry the running total.
  let collections = 0;

  for (const l of log) {
    let m = OPEN.exec(l.text);
    if (m) {
      const [, countdownReady, menuSeconds, hold, holdSeconds, holdReady, now] = m;
      processStartLogT ??= l.t - Number(now);
      format = Math.max(format, Number(/format (\d+)/.exec(l.text)![1]));
      const ready = Number(countdownReady ?? holdReady);
      const seconds = Number(menuSeconds ?? holdSeconds);
      block = { t: ready * 1000, start: (ready - seconds) * 1000, label: hold ?? "LOADING->MAINMENU" };
      records.push({ t: block.start, kind: "span", name: "scene.transition", detail: block.label, dur: seconds * 1000 });
      records.push({ t: block.t, kind: "mark", name: "checkpoint", detail: block.label });
      continue;
    }
    if (!block) continue;
    if ((m = FRAME.exec(l.text))) {
      const frame: ProfilerRecord = { t: Number(m[2]) * 1000, kind: "span", name: "frame.long", detail: m[1], dur: Number(m[3]) * 1000 };
      if (m[4] !== undefined) frame.gcCount = Number(m[4]);
      if (m[5] !== undefined) frame.covered = Number(m[5]) * 1000;
      records.push(frame);
      for (const run of m[6]?.split(" ") ?? []) {
        const r = RUN.exec(run);
        if (r) records.push({ t: Number(r[1]) * 1000, kind: "span", name: "frame.covered", detail: m[1], dur: Number(r[2]) * 1000, covered: Number(r[3]) * 1000 });
      }
    } else if ((m = CALIBRATION.exec(l.text))) {
      records.push({ t: block.t, kind: "counter", name: "harmony.call.calibration.patches", value: Number(m[1]) });
      records.push({ t: block.t, kind: "counter", name: "harmony.call.calibration.body", value: Number(m[2]) });
    } else if ((m = BRACKETED.exec(l.text))) {
      records.push({ t: block.t, kind: "counter", name: "harmony.call.bracketed", value: Number(m[1]) });
      records.push({ t: block.t, kind: "counter", name: "harmony.call.skipped", value: Number(m[2]), detail: m[3] ?? "" });
    } else if ((m = PATCH_CALL.exec(l.text))) {
      records.push({ t: block.t, kind: "aggregate", name: "harmony.call.patches", detail: m[1], total: Number(m[2]), count: Number(m[3]) });
      records.push({ t: block.t, kind: "aggregate", name: "harmony.call.body", detail: m[1], total: Number(m[4]), count: Number(m[3]) });
      if (m[5]) records.push({ t: block.t, kind: "mark", name: "harmony.call.bracket", detail: `${m[1]}: ${m[5]}` });
    } else if ((m = AGGREGATE.exec(l.text))) {
      records.push({ t: block.t, kind: "aggregate", name: FAMILIES[m[1]], detail: m[2], total: Number(m[3]), count: Number(m[4]) });
    } else if ((m = SWITCH.exec(l.text))) {
      // The steps' total as one span: rules sum the steps of a Hold.
      if (Number(m[2]) > 0) records.push({ t: block.start, kind: "span", name: "scene.bufferedLoad.step", dur: Number(m[1]) * 1000, steps: Number(m[2]) });
      records.push({ t: block.t, kind: "counter", name: "scene.overlayAfterGuiReady", detail: block.label, value: Number(m[3]) * 1000 });
    } else if ((m = ADDON_MEMORY.exec(l.text))) {
      records.push({ t: block.t, kind: "counter", name: "addon.awake.monoGrowth", detail: m[1], value: Number(m[2]) * MB });
    } else if ((m = MEMORY.exec(l.text))) {
      collections += Number(m[4]);
      records.push({
        t: block.t, kind: "memory", name: "scene.ready", detail: block.label,
        gcCount: collections, monoUsed: Number(m[1]) * MB, monoHeap: Number(m[2]) * MB, unityAllocated: Number(m[3]) * MB,
      });
    } else if ((m = GC_MODE.exec(l.text))) {
      facts ??= { t: block.t, kind: "facts", kspcfSettingsChanged: [] };
      facts.gcIncremental = m[1] === "unknown" ? undefined : m[1] === "yes";
      facts.gcMode = m[2] === "unknown" ? undefined : m[2];
    } else if ((m = KSPCF_NODES.exec(l.text))) {
      facts ??= { t: block.t, kind: "facts", kspcfSettingsChanged: [] };
      facts.kspcfSettingsNodes = Number(m[1]);
    } else if ((m = KSPCF_SETTING.exec(l.text))) {
      facts ??= { t: block.t, kind: "facts", kspcfSettingsChanged: [] };
      facts.kspcfSettingsChanged.push(m[1]);
    } else if (l.text.startsWith("[TMinus] Summary: end")) {
      block = undefined;
    }
  }
  if (processStartLogT === undefined) return undefined;
  return { records: [...loaders(log), ...(facts ? [facts] : []), ...records], processStartLogT, format };
}
