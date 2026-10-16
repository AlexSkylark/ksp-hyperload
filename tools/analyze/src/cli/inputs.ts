// A run's files as the mod embeds them in the report template: KSP.log and
// the newest .jsonl, each gzipped and base64. Node side of src/page/inputs.ts.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { gzipSync } from "node:zlib";
import { INPUTS_FORMAT, type Inputs } from "../page/inputs.js";

const packed = (path: string) => Buffer.from(gzipSync(readFileSync(path))).toString("base64");

/** The newest .jsonl in a run folder, as the CLI reads it. */
export function runJsonl(runDir: string): string | undefined {
  const jsonl = readdirSync(runDir).filter((f) => f.endsWith(".jsonl")).sort().pop();
  return jsonl ? join(runDir, jsonl) : undefined;
}

/** The inputs block of an archived run; the name defaults to the folder's name. */
export function runInputs(runDir: string, name = basename(runDir)): Inputs {
  const jsonl = runJsonl(runDir);
  const log = join(runDir, "KSP.log");
  if (!existsSync(log)) throw new Error(`no KSP.log in ${runDir}`);
  return { format: INPUTS_FORMAT, name, log: packed(log), ...(jsonl ? { jsonl: packed(jsonl) } : {}) };
}
