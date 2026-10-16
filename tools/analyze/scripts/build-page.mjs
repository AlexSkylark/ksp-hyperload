// Builds the report page from tsc's output in dist/ (run by `npm run build`):
//   dist/page/template.html     what the mod ships; it fills the inputs slot
//   dist/page/analyzer.bundle.js the analyzer alone, for check-archived
//
// Our own bundler, no dependency (TypeScript 7 has no outFile). From an entry
// it walks the imports and wraps each module in its own function in a small
// registry, so equal top-level names in two modules never clash. It rewrites
// only the import and export forms tsc emits and fails on anything else.
//
// Usage: node scripts/build-page.mjs

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, posix } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = join(ROOT, "dist");
const FONTS = join(ROOT, "fonts");


const IDENT = "[A-Za-z_$][\\w$]*";
const NAMES = new RegExp(`^(${IDENT})(?:\\s+as\\s+(${IDENT}))?$`);

/** "a, b as c" → [["a", "a"], ["b", "c"]]: [name there, name here]. */
function names(list, where) {
  return list
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const m = NAMES.exec(s);
      if (!m) throw new Error(`${where}: cannot read "${s}"`);
      return [m[1], m[2] ?? m[1]];
    });
}

const resolveId = (from, spec, where) => {
  if (!spec.startsWith(".")) throw new Error(`${where}: imports "${spec}", which is not a file of ours`);
  return posix.normalize(posix.join(posix.dirname(from), spec));
};

/** One module of tsc's output: its body without imports and exports, its dependencies, its exports. */
function readModule(id) {
  const source = readFileSync(join(DIST, id), "utf8");
  if (/\bimport\s*\(|\bimport\.meta\b/.test(source)) throw new Error(`${id}: dynamic import or import.meta`);
  const deps = [];
  const exports = []; // [name outside, expression inside]
  const head = [];
  const body = source.replace(/^(import|export)\b[^;]*;?[ \t]*$/gm, (stmt) => {
    let m;
    if ((m = /^import\s*\{([^}]*)\}\s*from\s*"([^"]+)";$/.exec(stmt))) {
      const dep = resolveId(id, m[2], id);
      deps.push(dep);
      const bound = names(m[1], id).map(([there, here]) => (there === here ? there : `${there}: ${here}`));
      head.push(`const { ${bound.join(", ")} } = __tminus[${JSON.stringify(dep)}];`);
      return "";
    }
    if ((m = /^import\s*"([^"]+)";$/.exec(stmt))) {
      deps.push(resolveId(id, m[1], id));
      return "";
    }
    if ((m = /^export\s*\{([^}]*)\}\s*from\s*"([^"]+)";$/.exec(stmt))) {
      const dep = resolveId(id, m[2], id);
      deps.push(dep);
      for (const [there, here] of names(m[1], id)) exports.push([here, `__tminus[${JSON.stringify(dep)}][${JSON.stringify(there)}]`]);
      return "";
    }
    if ((m = /^export\s*\{([^}]*)\};$/.exec(stmt))) {
      for (const [local, outside] of names(m[1], id)) exports.push([outside, local]);
      return "";
    }
    if ((m = new RegExp(`^export\\s+((?:async\\s+)?function\\*?|const|let|class)\\s+(${IDENT})`).exec(stmt))) {
      exports.push([m[2], m[2]]);
      return stmt.replace(/^export\s+/, "");
    }
    throw new Error(`${id}: cannot bundle "${stmt.split("\n")[0]}"`);
  });
  // A declaration whose statement spans lines (an exported function or object) is matched above by its first line only.
  const left = body.replace(/^(?:const|let|function|class|async)\b/gm, "");
  if (/^(?:import|export)\b/m.test(left)) throw new Error(`${id}: an import or export the bundler did not read`);
  return { id, deps, exports, code: `${head.join("\n")}\n${body}` };
}

/** The modules an entry needs, each after its dependencies. */
function graph(entry) {
  const order = [];
  const state = new Map(); // id → "visiting" | "done"
  const visit = (id, path) => {
    if (state.get(id) === "done") return;
    if (state.get(id) === "visiting") throw new Error(`import cycle: ${[...path, id].join(" → ")}`);
    state.set(id, "visiting");
    const m = readModule(id);
    for (const d of m.deps) visit(d, [...path, id]);
    state.set(id, "done");
    order.push(m);
  };
  visit(entry, []);
  return order;
}

/** An expression whose value is the entry's exports, after running every module once. */
export function bundle(entry) {
  const parts = graph(entry).map(
    (m) => `__tminus[${JSON.stringify(m.id)}] = (() => {\n${m.code}\nreturn { ${m.exports.map(([k, v]) => (k === v ? k : `${k}: ${v}`)).join(", ")} };\n})();`,
  );
  const code = `(() => {\n"use strict";\nconst __tminus = {};\n${parts.join("\n")}\nreturn __tminus[${JSON.stringify(entry)}];\n})()`;
  // Inside an inline script, "</script" ends the element and "<!--" changes how the rest is read.
  // In string, template and regex literals "<\/" means the same as "</"; elsewhere tsc's output has neither.
  const safe = code.replace(/<\/(script)/gi, "<\\/$1");
  if (/<!--/.test(safe)) throw new Error(`${entry}: "<!--" in the code, which an inline script cannot hold`);
  return safe;
}

function fontCss() {
  const faces = JSON.parse(readFileSync(join(FONTS, "fonts.json"), "utf8"));
  return faces
    .map((f) => {
      const ttf = f.file.endsWith(".ttf");
      const data = readFileSync(join(FONTS, f.file)).toString("base64");
      const range = f.range ? `unicode-range:${f.range};` : "";
      return `@font-face{font-family:"${f.family}";font-style:normal;font-weight:${f.weight};font-display:block;src:url(data:font/${ttf ? "ttf" : "woff2"};base64,${data}) format("${ttf ? "truetype" : "woff2"}");${range}}`;
    })
    .join("\n");
}

const { STYLE } = await import("../dist/report/style.js");
const { INPUTS_SLOT } = await import("../dist/page/inputs.js");
const analyzer = bundle("page/analyzer.js");
const template = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>T-Minus Flight Report</title>
<style id="tminus-fonts">${fontCss()}</style>
<style>${STYLE}</style>
</head>
<body>
<div class="wrap"><section class="win" aria-labelledby="tminus-status-title"><div class="bar"><span id="tminus-status-title">T-MINUS</span><small>flight report</small></div>
<div class="body" id="tminus-status"><p>Reading the log this report carries…</p>
<noscript><p>This report needs JavaScript: it analyzes the KSP.log it carries here, on this computer. Nothing is sent anywhere.</p></noscript></div></section></div>
${INPUTS_SLOT}
<script type="text/plain" id="tminus-behavior">${bundle("page/behavior.js")};</script>
<script>${bundle("page/boot.js")};</script>
</body>
</html>
`;
writeFileSync(join(DIST, "page", "template.html"), template);
writeFileSync(join(DIST, "page", "analyzer.bundle.js"), `${analyzer}\n`);
console.log(`template.html ${(template.length / 1024).toFixed(0)} KB, analyzer ${(analyzer.length / 1024).toFixed(0)} KB`);
