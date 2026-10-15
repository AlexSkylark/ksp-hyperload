// A run: one KSP session, its log and (optionally) its profiler records.

import { parseLog, type LogLine, type MmDump } from "./log.js";
import { parseJsonl, type ProfilerRecord } from "./profiler.js";
import { parseSummary } from "./summary.js";

export interface Run {
  name: string;
  /** KSP.log's timeline: every timestamped line outside ModuleManager's log dumps. */
  log: LogLine[];
  /** ModuleManager's log dumps, apart from the timeline (their lines have their own clock). */
  mmDumps: MmDump[];
  /** Profiler records from the .jsonl, or else from the summary in KSP.log; empty when there are neither. */
  records: ProfilerRecord[];
  /** Where the records come from. */
  recordsFrom?: "jsonl" | "summary";
  profilerOn: boolean;
  version: string;
  /** KSP.log time (s) of profiler time 0 (process start), when known. */
  processStartLogT?: number;
}

/** Builds a run from the text of its KSP.log and, when there is one, its profiler .jsonl. */
export function buildRun(name: string, logText: string, jsonlText?: string): Run {
  const { lines: log, mmDumps } = parseLog(logText);

  // Runs before 2026-10-15 were made under the project's old name, HyperLoad:
  // "[HyperLoad] HyperLoad <version> loaded". Accept both tags.
  const loaded = log.find((l) => /^\[(TMinus|HyperLoad)\] (T-Minus|HyperLoad) \S+ loaded/.test(l.text));
  const version = loaded?.text.match(/(?:T-Minus|HyperLoad) (\S+) loaded/)?.[1] ?? "not installed";
  const disabled = log.some((l) => /^\[(TMinus|HyperLoad)\] Profiler: disabled/.test(l.text));

  if (jsonlText !== undefined) {
    const records = parseJsonl(jsonlText);
    // Anchor profiler time to log time: the "loaded" line is written right when
    // the profiler starts (profilerStartMs after process start).
    const header = records.find((r) => r.kind === "run");
    const processStartLogT = loaded && header ? loaded.t - header.profilerStartMs / 1000 : undefined;
    return { name, log, mmDumps, records, recordsFrom: "jsonl", profilerOn: records.length > 0 && !disabled, version, processStartLogT };
  }

  const summary = parseSummary(log);
  if (summary) return { name, log, mmDumps, records: summary.records, recordsFrom: "summary", profilerOn: true, version, processStartLogT: summary.processStartLogT };
  return { name, log, mmDumps, records: [], profilerOn: false, version };
}
