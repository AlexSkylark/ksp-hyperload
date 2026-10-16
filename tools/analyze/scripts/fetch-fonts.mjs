// Downloads the page's fonts into fonts/ (run by hand; the files are
// committed, so builds work offline). All OFL, from Google Fonts: the Latin
// subset of each weight of two text families; Share Tech Mono whole and
// unmodified (its license reserves the name "Share", which a subset, being a
// modified version, could not use); and a fallback family,
// "T-Minus Symbols", with only the symbols the report prints outside Latin
// (none of the three has them all), requested by text from two Noto
// families. Writes fonts/fonts.json, which the page build turns into
// @font-face rules.
//
// Usage: node scripts/fetch-fonts.mjs

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "fonts");
// A current browser's agent, or Google answers with TTF instead of WOFF2.
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
const FAMILIES = [
  { name: "Chakra Petch", query: "Chakra+Petch", weights: [500, 600, 700], license: "chakrapetch" },
  { name: "Noto Sans", query: "Noto+Sans", weights: [400, 600, 700], license: "notosans" },
];
/** Unmodified files from google/fonts. */
const WHOLE = [{ name: "Share Tech Mono", weight: 400, path: "ofl/sharetechmono/ShareTechMono-Regular.ttf", license: "sharetechmono" }];
/** The fallback family: the characters the report prints outside Latin, from fonts that have them. */
const SYMBOLS = [
  { query: "Noto+Sans+Math", text: "→≈≥", license: "notosansmath" },
  { query: "Noto+Sans+Symbols+2", text: "▸▾▴", license: "notosanssymbols2" },
];

const get = async (url, as) => {
  const res = await fetch(url, { headers: { "user-agent": UA } });
  if (!res.ok) throw new Error(`${res.status} for ${url}`);
  return as === "text" ? res.text() : Buffer.from(await res.arrayBuffer());
};

/** The @font-face blocks of a css2 answer: subset comment, range (absent for a single file), url. */
function faces(css) {
  const out = [];
  for (const m of css.matchAll(/(?:\/\* ([\w-]+) \*\/\s*)?@font-face \{([^}]*)\}/g)) {
    const url = /url\(([^)]+)\)/.exec(m[2])?.[1];
    const range = /unicode-range: ([^;]+);/.exec(m[2])?.[1];
    if (url) out.push({ subset: m[1], url, range });
  }
  return out;
}

mkdirSync(OUT, { recursive: true });
const files = [];
const save = async (family, weight, file, face) => {
  const data = await get(face.url);
  writeFileSync(join(OUT, file), data);
  files.push({ family, weight, file, ...(face.range ? { range: face.range } : {}) });
  console.log(`${file} ${data.length} bytes`);
};
const license = async (name) =>
  writeFileSync(join(OUT, `${name}-OFL.txt`), await get(`https://raw.githubusercontent.com/google/fonts/main/ofl/${name}/OFL.txt`, "text"));

for (const f of FAMILIES) {
  for (const w of f.weights) {
    const latin = faces(await get(`https://fonts.googleapis.com/css2?family=${f.query}:wght@${w}`, "text")).find((x) => x.subset === "latin");
    if (!latin) throw new Error(`no latin subset for ${f.name} ${w}`);
    await save(f.name, w, `${f.license}-${w}-latin.woff2`, latin);
  }
  await license(f.license);
}
for (const w of WHOLE) {
  await save(w.name, w.weight, w.path.split("/").pop(), { url: `https://raw.githubusercontent.com/google/fonts/main/${w.path}` });
  await license(w.license);
}
for (const s of SYMBOLS) {
  const face = faces(await get(`https://fonts.googleapis.com/css2?family=${s.query}&text=${encodeURIComponent(s.text)}`, "text"))[0];
  if (!face) throw new Error(`no file for ${s.query}`);
  // A text request answers even when the font lacks a character: the file download fails then.
  await save("T-Minus Symbols", 400, `${s.license}-symbols.woff2`, { url: face.url, range: [...s.text].map((c) => `U+${c.codePointAt(0).toString(16).toUpperCase()}`).join(", ") });
  await license(s.license);
}
writeFileSync(join(OUT, "fonts.json"), JSON.stringify(files, null, 2) + "\n");
