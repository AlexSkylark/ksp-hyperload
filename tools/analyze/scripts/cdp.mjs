// Dev-only: drives headless Chrome over the DevTools protocol to check the
// report page and take screenshots. Not part of any build or test.
//
// Minimal Chrome DevTools driver: node cdp.mjs <page.html> <script.mjs>
// script.mjs default-exports async ({ evaluate, shot, wait }) => void.
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const [page, scriptPath] = process.argv.slice(2);
const profile = mkdtempSync(join(tmpdir(), "cdp-"));
const chrome = spawn(CHROME, ["--headless=new", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "--window-size=1280,900", "--no-first-run", "about:blank"], { stdio: ["ignore", "ignore", "pipe"] });
const wsUrl = await (async () => {
  for (let i = 0; i < 60; i++) {
    await new Promise((ok) => setTimeout(ok, 250));
    try {
      const [p, path] = readFileSync(join(profile, "DevToolsActivePort"), "utf8").split(/\r?\n/);
      if (p && path) return `ws://127.0.0.1:${p}${path}`;
    } catch {}
  }
  throw new Error("no DevToolsActivePort");
})();
const port = new URL(wsUrl).port;
const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const pageTarget = targets.find((t) => t.type === "page");
const ws = new WebSocket(pageTarget.webSocketDebuggerUrl);
await new Promise((ok) => ws.addEventListener("open", ok));
let id = 0;
const pending = new Map();
const errors = [];
ws.addEventListener("message", (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m);
    pending.delete(m.id);
  } else if (m.method === "Runtime.exceptionThrown") errors.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
  else if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") errors.push(m.params.args.map((a) => a.value ?? a.description).join(" "));
});
const send = (method, params = {}) =>
  new Promise((ok) => {
    const n = ++id;
    pending.set(n, ok);
    ws.send(JSON.stringify({ id: n, method, params }));
  });
await send("Runtime.enable");
await send("Page.enable");
await send("Browser.grantPermissions", { permissions: ["clipboardReadWrite", "clipboardSanitizedWrite"] }).catch(() => {});
const evaluate = async (expr) => {
  const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? JSON.stringify(r.result.exceptionDetails));
  return r.result?.result?.value;
};
const wait = (ms) => new Promise((ok) => setTimeout(ok, ms));
const shot = async (file, full = false) => {
  const r = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: full });
  writeFileSync(file, Buffer.from(r.result.data, "base64"));
};
const setViewport = (width, height, mobile = false) => send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile });
await send("Page.navigate", { url: pathToFileURL(resolve(page)).href });
for (let i = 0; i < 120; i++) {
  await wait(500);
  if (await evaluate("!!document.getElementById('tabs') || /could not build/.test(document.body?.innerText ?? '')").catch(() => false)) break;
}
await wait(500);
const { default: run } = await import(pathToFileURL(resolve(scriptPath)).href);
try {
  await run({ evaluate, shot, wait, setViewport, send });
} catch (e) {
  console.log("SCRIPT ERROR", e.message);
}
console.log(errors.length ? `PAGE ERRORS:\n${errors.join("\n")}` : "no page errors");
ws.close();
chrome.kill();
process.exit(0);
