// The inputs block the mod writes into the report template, and how the page
// reads it. No DOM and no Node: the CLI fills templates with it too
// (check-archived, fill-template). The mod's C# writer follows the same
// format; change both together.

/** The inputs block's format number. */
export const INPUTS_FORMAT = 1;

/** The template's line that the inputs block replaces. "\x21" is "!": the page's own script cannot hold the comment's opening. */
export const INPUTS_SLOT = "<\x21-- TMINUS-INPUTS -->";

/** What the mod embeds: each file gzipped, then base64. */
export interface Inputs {
  format: number;
  /** The session's name, shown as the run's name. No path: a path would name the user. */
  name: string;
  log: string;
  jsonl?: string;
}

/** The block for the slot. "<" is escaped so no text in it can end the element. */
export function inputsBlock(inputs: Inputs): string {
  return `<script type="application/json" id="tminus-inputs">${JSON.stringify(inputs).replace(/</g, "\\u003c")}</script>`;
}

/** The template with its slot filled; the slot must appear exactly once. */
export function fillTemplate(template: string, inputs: Inputs): string {
  const at = template.indexOf(INPUTS_SLOT);
  if (at < 0 || template.indexOf(INPUTS_SLOT, at + 1) >= 0) throw new Error("the template must have exactly one inputs slot");
  return template.slice(0, at) + inputsBlock(inputs) + template.slice(at + INPUTS_SLOT.length);
}

export function parseInputs(json: string): Inputs {
  const v: unknown = JSON.parse(json);
  if (typeof v !== "object" || v === null) throw new Error("the inputs block is not an object");
  const o = v as Record<string, unknown>;
  if (o.format !== INPUTS_FORMAT) throw new Error(`inputs format ${String(o.format)}; this page reads format ${INPUTS_FORMAT}`);
  if (typeof o.name !== "string" || typeof o.log !== "string") throw new Error("the inputs block has no name or no KSP.log");
  if (o.jsonl !== undefined && typeof o.jsonl !== "string") throw new Error("the inputs block's profiler records are not text");
  return { format: o.format, name: o.name, log: o.log, jsonl: o.jsonl };
}
