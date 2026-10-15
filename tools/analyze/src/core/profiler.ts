// Profiler .jsonl parser.

/** One record of the profiler's .jsonl (kinds: run, conditions, span, aggregate). */
export type ProfilerRecord = Record<string, any>;

export function parseJsonl(text: string): ProfilerRecord[] {
  return text.split(/\r?\n/).filter((l) => l.trim()).map((l) => JSON.parse(l));
}
