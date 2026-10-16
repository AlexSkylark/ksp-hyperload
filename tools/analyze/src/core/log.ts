// KSP.log parser.
//
// KSP.log has one timeline, except for ModuleManager's dump (see
// docs/mechanisms.md, 1.6): one log entry that carries MM's own log, whose
// lines have their own timestamps, earlier than the entry. When MM used its
// cache, the dump also nests the patch log of an earlier startup. The parser
// keeps the dump out of the timeline and returns it apart, so timing code
// never mixes clocks and MM rules read it explicitly.

export interface LogLine {
  /** 1-based line number in the file, for citing evidence. */
  n: number;
  /** Seconds since midnight of the run's first day (rolls past 86400 after midnight). */
  t: number;
  level: string;
  text: string;
  /** Non-empty lines without a timestamp that follow this one (stack traces, multi-line messages). */
  more?: { n: number; text: string }[];
}

/** One ModuleManager log dump ("#### BEGIN/END MODULEMANAGER LOG ####"). */
export interface MmDump {
  /** The timeline entry that carries the dump ("[ModuleManager] " followed by the markers). */
  entry: LogLine;
  /** MM's log for this startup, written by its worker threads: this session's clock, earlier than the entry. */
  lines: LogLine[];
  /**
   * When MM used its cache: the patch log of the earlier startup that built
   * the cache. It describes the patches behind the configs in use, but its
   * timestamps belong to that startup (t is seconds since its own midnight).
   */
  patchLog?: LogLine[];
  /** False when the log ends before the closing marker. */
  complete: boolean;
}

export interface ParsedLog {
  /** The timeline: every timestamped line outside MM dumps. */
  lines: LogLine[];
  /** MM dumps in file order: the startup's, then one per database reload from MM's menu. */
  mmDumps: MmDump[];
}

const LOG_LINE = /^\[(LOG|WRN|ERR|EXC) (\d\d):(\d\d):(\d\d\.\d+)\] ?(.*)$/;

const MM_BEGIN = "#### BEGIN MODULEMANAGER LOG ####";
const MM_END = "#### END MODULEMANAGER LOG ####";
const PATCH_BEGIN = "#### BEGIN PATCH LOG ####";
const PATCH_END = "#### END PATCH LOG ####";

export function parseLog(text: string): ParsedLog {
  const lines: LogLine[] = [];
  const mmDumps: MmDump[] = [];
  let dayOffset = 0;
  let last = 0;
  /** The dump being read, and which of its parts. */
  let dump: MmDump | undefined;
  let inPatchLog = false;
  /** The line that untimestamped lines attach to. */
  let prev: LogLine | undefined;

  const raws = text.split(/\r?\n/);
  for (let i = 0; i < raws.length; i++) {
    const raw = raws[i];
    const m = LOG_LINE.exec(raw);
    if (!m) {
      const marker = raw.trim();
      if (!dump && marker === MM_BEGIN && prev) {
        dump = { entry: prev, lines: [], complete: false };
        mmDumps.push(dump);
      } else if (dump && marker === MM_END) {
        dump.complete = true;
        dump = undefined;
        inPatchLog = false;
        prev = lines[lines.length - 1];
        continue;
      } else if (dump && !inPatchLog && marker === PATCH_BEGIN) {
        dump.patchLog = [];
        inPatchLog = true;
        continue;
      } else if (dump && inPatchLog && marker === PATCH_END) {
        inPatchLog = false;
        prev = dump.lines[dump.lines.length - 1] ?? dump.entry;
        continue;
      }
      if (prev && marker) (prev.more ??= []).push({ n: i + 1, text: raw });
      continue;
    }

    const clock = Number(m[2]) * 3600 + Number(m[3]) * 60 + Number(m[4]);
    if (dump && inPatchLog) {
      prev = { n: i + 1, t: clock, level: m[1], text: m[5] };
      dump.patchLog!.push(prev);
    } else if (dump) {
      // Same session as the entry, and never later than it: a later time means the session crossed midnight while MM patched.
      let t = clock + dayOffset;
      if (t > dump.entry.t + 1) t -= 86400;
      prev = { n: i + 1, t, level: m[1], text: m[5] };
      dump.lines.push(prev);
    } else {
      let t = clock + dayOffset;
      if (t < last - 3600) {
        // Clock went backwards by a lot: the run crossed midnight.
        dayOffset += 86400;
        t += 86400;
      }
      last = t;
      prev = { n: i + 1, t, level: m[1], text: m[5] };
      lines.push(prev);
    }
  }
  return { lines, mmDumps };
}

/**
 * A decimal number as KSP.log prints it. Numbers formatted on worker threads,
 * where KSP did not set the culture, can use "," as the separator
 * (docs/mechanisms.md, 1.1): match and parse both.
 */
export const DECIMAL = String.raw`\d+(?:[.,]\d+)?`;

export function decimal(text: string): number {
  return Number(text.replace(",", "."));
}
