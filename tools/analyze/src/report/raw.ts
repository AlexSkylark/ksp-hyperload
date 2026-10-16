// Raw data: the analysis' full tables, for the local page's Raw data tab.
// Kept out of Report: the downloaded report has no Raw data tab (decision 7),
// so nothing here is curated or redacted. It holds keys (addons, modules,
// folders, methods) and numbers, not log text.

import type { RunAnalysis } from "../core/model.js";
import { holdName } from "./wording.js";

export interface RawTable {
  title: string;
  columns: string[];
  rows: (string | number)[][];
}

const ms = (x: number) => Math.round(x * 10) / 10;
const s = (x: number) => Math.round(x * 1000) / 1000;

export function buildRaw(a: RunAnalysis): RawTable[] {
  const out: RawTable[] = [];
  out.push({
    title: "Countdown metrics",
    columns: ["metric", "s"],
    rows: a.countdown.metrics.filter((m) => m.seconds !== undefined).map((m) => [m.label, s(m.seconds!)]),
  });
  if (a.countdown.loaders.length)
    out.push({ title: "Loading systems", columns: ["loader", "s", "approximate"], rows: a.countdown.loaders.map((l) => [l.name, s(l.seconds), l.approx ? "yes" : ""]) });
  if (a.holds.length) out.push({ title: "Holds", columns: ["Hold", "s", "source"], rows: a.holds.map((h) => [holdName(h.label), s(h.seconds), h.source]) });
  if (a.longFrames?.length)
    out.push({
      title: "Long frames",
      columns: ["scene", "where", "s", "log gaps s", "in timed hooks s"],
      rows: a.longFrames.map((f) => [f.label, f.phase === "hold" ? holdName(f.hold!) : f.phase, s(f.seconds), s(f.gapSeconds), f.coveredSeconds === undefined ? "" : s(f.coveredSeconds)]),
    });
  if (a.countdown.assets)
    out.push({
      title: "Asset loading by folder",
      columns: ["folder", "files", "s"],
      rows: a.countdown.assets.byFolder.map((g) => [g.key, g.files, s(g.seconds)]),
    });
  for (const f of a.aggregates) out.push({ title: `Profiler: ${f.family}`, columns: ["key", "ms"], rows: f.entries.map((e) => [e.key, ms(e.ms)]) });
  if (a.slowEvents.length) out.push({ title: "Slowest GameEvent dispatches", columns: ["event", "ms"], rows: a.slowEvents.map((e) => [e.event, ms(e.ms)]) });
  return out;
}
