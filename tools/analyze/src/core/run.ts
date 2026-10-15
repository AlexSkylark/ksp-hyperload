// A run: one KSP session, its log and (optionally) its profiler records.

import { parseLog, type LogLine } from "./log.js";
import { parseJsonl, type ProfilerRecord } from "./profiler.js";

export interface Run {
  name: string;
  log: LogLine[];
  /** Records from the profiler .jsonl; empty when the profiler was off. */
  records: ProfilerRecord[];
  profilerOn: boolean;
  version: string;
  /** KSP.log time (s) of profiler time 0 (process start), when known. */
  processStartLogT?: number;
}

/** Builds a run from the text of its KSP.log and, when there is one, its profiler .jsonl. */
export function buildRun(name: string, logText: string, jsonlText?: string): Run {
  const log = parseLog(logText);
  const records = jsonlText !== undefined ? parseJsonl(jsonlText) : [];

  // Runs before 2026-10-15 were made under the project's old name, HyperLoad:
  // "[HyperLoad] HyperLoad <version> loaded". Accept both tags.
  const loaded = log.find((l) => /^\[(TMinus|HyperLoad)\] (T-Minus|HyperLoad) \S+ loaded/.test(l.text));
  const version = loaded?.text.match(/(?:T-Minus|HyperLoad) (\S+) loaded/)?.[1] ?? "not installed";
  const profilerOn =
    records.length > 0 && !log.some((l) => /^\[(TMinus|HyperLoad)\] Profiler: disabled/.test(l.text));

  // Anchor profiler time to log time: the "loaded" line is written right when
  // the profiler starts (profilerStartMs after process start).
  const header = records.find((r) => r.kind === "run");
  const processStartLogT = loaded && header ? loaded.t - header.profilerStartMs / 1000 : undefined;

  return { name, log, records, profilerOn, version, processStartLogT };
}
