// KSP.log parser.

export interface LogLine {
  /** Seconds since midnight of the run's first day (rolls past 86400 after midnight). */
  t: number;
  level: string;
  text: string;
}

const LOG_LINE = /^\[(LOG|WRN|ERR|EXC) (\d\d):(\d\d):(\d\d\.\d+)\] ?(.*)$/;

/** Timestamped lines of a KSP.log; continuation lines (stack traces etc.) are skipped. */
export function parseLog(text: string): LogLine[] {
  const lines: LogLine[] = [];
  let dayOffset = 0;
  let last = 0;
  for (const raw of text.split(/\r?\n/)) {
    const m = LOG_LINE.exec(raw);
    if (!m) continue;
    let t = Number(m[2]) * 3600 + Number(m[3]) * 60 + Number(m[4]) + dayOffset;
    if (t < last - 3600) {
      // Clock went backwards by a lot: the run crossed midnight.
      dayOffset += 86400;
      t += 86400;
    }
    last = t;
    lines.push({ t, level: m[1], text: m[5] });
  }
  return lines;
}
