// KSP.log parser.

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

const LOG_LINE = /^\[(LOG|WRN|ERR|EXC) (\d\d):(\d\d):(\d\d\.\d+)\] ?(.*)$/;

/** Timestamped lines of a KSP.log; continuation lines are attached to the line before them. */
export function parseLog(text: string): LogLine[] {
  const lines: LogLine[] = [];
  let dayOffset = 0;
  let last = 0;
  const raws = text.split(/\r?\n/);
  for (let i = 0; i < raws.length; i++) {
    const m = LOG_LINE.exec(raws[i]);
    if (!m) {
      const prev = lines[lines.length - 1];
      if (prev && raws[i].trim()) (prev.more ??= []).push({ n: i + 1, text: raws[i] });
      continue;
    }
    let t = Number(m[2]) * 3600 + Number(m[3]) * 60 + Number(m[4]) + dayOffset;
    if (t < last - 3600) {
      // Clock went backwards by a lot: the run crossed midnight.
      dayOffset += 86400;
      t += 86400;
    }
    last = t;
    lines.push({ n: i + 1, t, level: m[1], text: m[5] });
  }
  return lines;
}
