// Parser for the profiler's summary in KSP.log (src/TMinus/Profiler/LogSummary.cs).
//
// At the end of the Countdown and of each Hold the profiler writes a block:
//
//   [TMinus] Summary (format 1): Countdown ready at 261.930 s (main menu scene 57.28 s), this line at 261.950 s after process start
//   [TMinus] Summary (format 1): Hold EDITOR->FLIGHT 37.27 s, ready at 377.233 s, this line at 377.251 s after process start
//   [TMinus] Summary: long frame MAINMENU at 204.644 s, 48.000 s
//   [TMinus] Summary: addon Awake Kopernicus/Kopernicus.Injector 4580 ms, 1 call
//   [TMinus] Summary: parts (other 30) 5120 ms, 412 parts
//   [TMinus] Summary: end | 1 long frame 48.0 s, addon Awake 7.2 s, parts 34.2 s
//
// The blocks become the same records the .jsonl holds (scene transitions,
// long frames, checkpoints, aggregates), so every rule reads them unchanged.
// Times are seconds since process start.

import type { LogLine } from "./log.js";
import type { ProfilerRecord } from "./profiler.js";

export interface Summary {
  records: ProfilerRecord[];
  /** KSP.log time (s) of process start, from the first block's own time. */
  processStartLogT: number;
}

const OPEN = /^\[TMinus\] Summary \(format 1\): (?:Countdown ready at ([\d.]+) s \(main menu scene ([\d.]+) s\)|Hold (\S+) ([\d.]+) s, ready at ([\d.]+) s), this line at ([\d.]+) s after process start$/;
const FRAME = /^\[TMinus\] Summary: long frame (\S+) at ([\d.]+) s, ([\d.]+) s$/;
const AGGREGATE = /^\[TMinus\] Summary: (addon Awake|addon Start|parts) (.+) (\d+) ms, (\d+) (?:calls?|parts?)$/;

const FAMILIES: Record<string, string> = { "addon Awake": "addon.awake", "addon Start": "addon.start", parts: "part.parse.byMod" };

/** The summary blocks in a KSP.log, or undefined when there are none. */
export function parseSummary(log: LogLine[]): Summary | undefined {
  const records: ProfilerRecord[] = [];
  let processStartLogT: number | undefined;
  let blockT: number | undefined;

  for (const l of log) {
    let m = OPEN.exec(l.text);
    if (m) {
      const [, countdownReady, menuSeconds, hold, holdSeconds, holdReady, now] = m;
      processStartLogT ??= l.t - Number(now);
      const ready = Number(countdownReady ?? holdReady);
      const seconds = Number(menuSeconds ?? holdSeconds);
      blockT = ready * 1000;
      records.push({ t: (ready - seconds) * 1000, kind: "span", name: "scene.transition", detail: hold ?? "LOADING->MAINMENU", dur: seconds * 1000 });
      records.push({ t: blockT, kind: "mark", name: "checkpoint", detail: hold ?? "LOADING->MAINMENU" });
      continue;
    }
    if (blockT === undefined) continue;
    if ((m = FRAME.exec(l.text))) {
      records.push({ t: Number(m[2]) * 1000, kind: "span", name: "frame.long", detail: m[1], dur: Number(m[3]) * 1000 });
    } else if ((m = AGGREGATE.exec(l.text))) {
      records.push({ t: blockT, kind: "aggregate", name: FAMILIES[m[1]], detail: m[2], total: Number(m[3]), count: Number(m[4]) });
    } else if (l.text.startsWith("[TMinus] Summary: end")) {
      blockT = undefined;
    }
  }
  return processStartLogT === undefined ? undefined : { records, processStartLogT };
}
