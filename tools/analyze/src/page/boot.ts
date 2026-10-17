// The template's script: reads the inputs the mod embedded, analyzes them in
// this page and replaces the document with the report. The report's own
// behavior runs from the rendered page (behavior.ts), so the saved copy keeps
// it without the analyzer.

import { analyzeInputs, parseInputs } from "./analyzer.js";

const ISSUES = "https://github.com/AlexSkylark/ksp-tminus/issues";

/** The shared copy's file name: the session's name, kept to safe characters. */
function downloadName(session: string): string {
  const safe = session.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return `${safe.startsWith("tminus") ? safe : `tminus-${safe || "report"}`}-shared.html`;
}

function status(...lines: (string | Node)[]): void {
  const box = document.getElementById("tminus-status");
  if (!box) return;
  box.replaceChildren(
    ...lines.map((l) => {
      const p = document.createElement("p");
      p.append(l);
      return p;
    }),
  );
}

async function boot(): Promise<void> {
  const slot = document.getElementById("tminus-inputs");
  if (!slot) {
    status(
      "This is the T-Minus report template. It holds no log yet.",
      "In KSP, click the T-Minus button: the mod copies this file with your session's KSP.log inside and opens it.",
    );
    return;
  }
  const inputs = parseInputs(slot.textContent ?? "");
  const out = await analyzeInputs(inputs, {
    fonts: document.getElementById("tminus-fonts")?.textContent ?? "",
    script: document.getElementById("tminus-behavior")?.textContent ?? "",
  });
  window.tminusDownload = out.download;
  window.tminusDownloadName = downloadName(inputs.name);
  document.open();
  document.write(out.page);
  document.close();
}

boot().catch((e: unknown) => {
  const issue = document.createElement("a");
  issue.href = ISSUES;
  issue.textContent = ISSUES;
  const detail = document.createElement("pre");
  detail.textContent = e instanceof Error ? `${e.message}\n${e.stack ?? ""}` : String(e);
  status(
    "T-Minus could not build this report.",
    "Please report it with the message below. Do not attach this file: it holds your whole KSP.log.",
    issue,
    detail,
  );
});
