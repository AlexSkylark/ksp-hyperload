// Fills the report template with an archived run's files, as the mod will:
// a page to open in a browser while the mod side does not exist yet.
//
// Usage: node scripts/fill-template.mjs <runDir> <out.html>

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const [runDir, out, ...extra] = process.argv.slice(2);
if (!runDir || !out || extra.length) {
  console.error("Usage: node scripts/fill-template.mjs <runDir> <out.html>");
  process.exit(1);
}
const DIST = join(dirname(fileURLToPath(import.meta.url)), "..", "dist");
const { runInputs } = await import("../dist/cli/inputs.js");
const { fillTemplate } = await import("../dist/page/inputs.js");
const page = fillTemplate(readFileSync(join(DIST, "page", "template.html"), "utf8"), runInputs(runDir));
writeFileSync(out, page);
console.log(`${out}: ${(page.length / 1024).toFixed(0)} KB`);
