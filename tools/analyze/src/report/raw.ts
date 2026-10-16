// Raw data: the analysis' full tables, for the local page's Raw data tab and
// the Markdown's technical details. Kept out of Report: the downloaded report
// has no Raw data tab (decision 7). Organized but not ranked or cut. Redacted
// like the model: every string goes through the run's redactor.

import type { LongFrame, RunAnalysis } from "../core/model.js";
import type { Phase } from "../core/phases.js";
import { redactor } from "./redact.js";
import { holdName, LEVEL_NAME, placeName, sceneName } from "./wording.js";

/** Where a number comes from: T-Minus' profiler, KSP.log, or the analyzer's own reading of them. */
export type RawSource = "profiler" | "log" | "analyzer";

export interface RawColumn {
  title: string;
  /** Numbers, right-aligned, shown with this many decimals. */
  digits?: number;
  /** Long text that may wrap. */
  wrap?: boolean;
}

export type RawCell = string | number | null;

export interface RawTable {
  kind: "table";
  columns: RawColumn[];
  /** In the order to show; a cell's lines are separated by "\n". */
  rows: RawCell[][];
}

export interface RawPairs {
  kind: "pairs";
  pairs: [string, string][];
}

export interface RawFinding {
  id: string;
  title: string;
  subject?: string;
  place: string;
  seconds?: number;
  cost: string;
  confidence: string;
  informational: boolean;
  within?: string;
  method: string;
  action: string;
  notes: string[];
  /** Every evidence line, not cut. */
  evidence: { source: "log" | "profiler"; line?: number; text: string }[];
}

export interface RawFindings {
  kind: "findings";
  findings: RawFinding[];
}

export type RawBlock = RawTable | RawPairs | RawFindings;

export interface RawSection {
  title: string;
  from: RawSource[];
  note?: string;
  /** Shown open. */
  open?: boolean;
  blocks: RawBlock[];
}

export interface RawGroup {
  /** Anchor id: "raw-run", "raw-countdown", ... */
  id: string;
  title: string;
  gloss?: string;
  note: string;
  sections: RawSection[];
}

const ms = (x: number) => Math.round(x * 10) / 10;
const s3 = (x: number) => Math.round(x * 1000) / 1000;

const SECONDS: RawColumn = { title: "s", digits: 2 };
const MS: RawColumn = { title: "ms", digits: 1 };
const table = (columns: RawColumn[], rows: RawCell[][]): RawTable => ({ kind: "table", columns, rows });

/** What each profiler family holds, in words. */
const FAMILY: Record<string, [string, string]> = {
  "addon.awake": ["Addon Awake, per class", "Awake of each mod's [KSPAddon] class. Key: folder/assembly.class."],
  "addon.start": ["Addon Start, per class", "Start of each mod's [KSPAddon] class (diagnostic mode)."],
  "scenario.load": ["ScenarioModule load, per class", "ScenarioModules reading their part of the save."],
  "gameEvent.fire": ["GameEvent dispatch, per event", "Handlers subscribed to each GameEvent, summed over every dispatch."],
  "configNode.load": ["Config file reading", "Parsing .cfg text into config nodes."],
  "part.parse.byMod": ["Part compilation, per folder", "PartLoader turning part configs into parts, per GameData folder."],
  "partLoader.methods": ["PartLoader steps", "Named steps inside PartLoader. A span is a coroutine measured from start to end, so it includes frames where other code ran."],
  "module.load": ["PartModule Load, per module", "Each PartModule reading its config: at part compilation and whenever a part is built."],
  "module.awake": ["PartModule Awake, per module", ""],
  "module.onStart": ["PartModule OnStart, per module", ""],
  "module.onStartFinished": ["PartModule OnStartFinished, per module", ""],
  "vesselModule.awake": ["VesselModule Awake, per module", ""],
  "vesselModule.start": ["VesselModule Start, per module", ""],
  "vesselModule.load": ["VesselModule Load, per module", ""],
  "harmony.patch": ["Harmony patching, per mod", "Time each mod spent applying its Harmony patches."],
};

const FRAMES_NOTE =
  "Frames longer than the report's threshold. Log silences: time with no KSP.log line inside the frame. In timed hooks: time the profiler's hooks measured inside it. The lines around each silence are the clue to who ran.";

function frames(list: LongFrame[]): RawTable {
  return table(
    [{ title: "Scene" }, { title: "Where" }, { title: "Frame s", digits: 2 }, { title: "Log silences s", digits: 2 }, { title: "In timed hooks s", digits: 2 }, { title: "Lines around the silences (source · gaps · s)", wrap: true }],
    list.map((f) => [
      sceneName(f.label),
      f.phase === "between" ? "between Holds" : placeName({ phase: f.phase, ...(f.hold ? { hold: f.hold } : {}) }),
      s3(f.seconds),
      s3(f.gapSeconds),
      f.coveredSeconds === undefined ? null : s3(f.coveredSeconds),
      f.around.map((g) => `${g.source} · ${g.gaps} · ${g.seconds.toFixed(2)} s`).join("\n"),
    ]),
  );
}

function phases(list: Phase[], who: boolean): RawTable {
  return table(
    [{ title: "#", digits: 0 }, { title: "Phase", wrap: true }, SECONDS, ...(who ? [{ title: "Who" }] : []), { title: "From line", digits: 0 }, { title: "To line", digits: 0 }, { title: "First line", wrap: true }, { title: "Last line", wrap: true }],
    list.map((p, i) => [i + 1, p.label, s3(p.seconds), ...(who ? [p.wait ? "waiting" : p.modCode ? "KSP + mods" : "KSP"] : []), p.from.n, p.to.n, p.from.text, p.to.text]),
  );
}

function runGroup(a: RunAnalysis): RawGroup {
  const pairs: [string, string][] = [
    ["T-Minus", a.version],
    ["Input", `${LEVEL_NAME[a.input.level]}${a.input.missing.length ? `; missing: ${a.input.missing.join("; ")}` : "; nothing missing"}`],
    ["Profiler", a.profilerOn ? "on" : "off"],
  ];
  const sys = a.system;
  if (sys?.ksp) pairs.push(["KSP", sys.ksp]);
  if (sys?.os) pairs.push(["OS", sys.os]);
  if (sys?.cpu) pairs.push(["CPU", sys.cpu]);
  if (sys?.gpu) pairs.push(["GPU", sys.gpu]);
  if (sys?.ramMb !== undefined) pairs.push(["RAM", `${sys.ramMb} MB`]);
  if (a.install) {
    if (a.install.assemblyCount !== undefined) pairs.push(["Assemblies loaded", String(a.install.assemblyCount)]);
    pairs.push(["KSPCommunityFixes", a.install.kspcf ? `${a.install.kspcf}, texture cache ${a.install.kspcfTextureCache === undefined ? "unknown" : a.install.kspcfTextureCache ? "on" : "off"}` : "absent"]);
    pairs.push(["PC uptime at launch", `${a.install.uptimeAtStartHours.toFixed(1)} h`]);
  }
  if (a.conditions) pairs.push(["ModuleManager cache", a.conditions.mmCache]);
  if (a.partDatabase) pairs.push(["PartDatabase.cfg", a.partDatabase]);
  const sections: RawSection[] = [{ title: "Input and install", from: ["analyzer", "log"], open: true, blocks: [{ kind: "pairs", pairs }] }];
  if (a.kspcfSettings)
    sections.push({
      title: "KSPCF settings changed by patches",
      from: ["profiler"],
      note: `${a.kspcfSettings.nodes} KSP_COMMUNITY_FIXES node${a.kspcfSettings.nodes === 1 ? "" : "s"} in the game database. Each row: the setting, its value in the installed Settings.cfg, and the value in effect.`,
      blocks: [
        table(
          [{ title: "Setting" }, { title: "Installed" }, { title: "In effect" }],
          a.kspcfSettings.changed.map((c) => {
            const m = /^(\S+): (.*) -> (.*)$/.exec(c);
            return m ? [m[1], m[2], m[3]] : [c, null, null];
          }),
        ),
      ],
    });
  const metrics: RawCell[][] = a.countdown.metrics.map((m) => [m.label, m.seconds === undefined ? null : s3(m.seconds)]);
  if (a.countdown.mainMenu) metrics.push([`Main menu scene, request to ready (${holdName(a.countdown.mainMenu.label)})`, s3(a.countdown.mainMenu.seconds)]);
  const timings: RawBlock[] = [table([{ title: "Metric" }, SECONDS], metrics)];
  const mm = a.countdown.moduleManager;
  if (mm) {
    const p: [string, string][] = [];
    if (mm.startDelay !== undefined) p.push(["Start delay: its Awake to its patching thread", `${mm.startDelay.toFixed(2)} s`]);
    if (mm.ranIn !== undefined) p.push([`Patching thread${mm.cache ? ` (cache ${mm.cache})` : ""}`, `${mm.ranIn.toFixed(2)} s`]);
    if (mm.waited !== undefined) p.push(["Main thread waited for it", `${mm.waited.toFixed(2)} s`]);
    if (mm.postPatch !== undefined) p.push(["Post-patch callbacks, on the main thread", `${mm.postPatch.toFixed(2)} s`]);
    if (mm.ranIn !== undefined && mm.waited !== undefined)
      p.push(["Alongside asset loading", mm.waited < 0.05 ? "all of the patching" : `${Math.max(0, mm.ranIn - mm.waited).toFixed(2)} s of the patching`]);
    timings.push({ kind: "pairs", pairs: p });
  }
  sections.push({
    title: "Timings reported by KSP and ModuleManager",
    from: ["log", "profiler"],
    note: "Totals the game and ModuleManager print themselves, next to the profiler's. They count from different starting points, so they do not add up.",
    blocks: timings,
  });
  return { id: "raw-run", title: "Run", note: "What was analyzed and under which conditions. Usernames and disk paths are removed; paths start at GameData.", sections };
}

function countdownGroup(a: RunAnalysis): RawGroup {
  const sections: RawSection[] = [];
  if (a.countdown.phases?.length)
    sections.push({
      title: "Phases",
      from: ["log"],
      open: true,
      note: "The Countdown cut at log lines that mark a stage. Who says whether mod code can run in the phase. Line numbers are KSP.log's.",
      blocks: [phases(a.countdown.phases, true)],
    });
  if (a.countdown.loaders.length)
    sections.push({
      title: "Loaders",
      from: ["profiler"],
      note: "KSP's loading screen steps. Approximate: the step runs alongside others, so its time is the span from its start to its end.",
      blocks: [table([{ title: "Loader" }, SECONDS, { title: "Approximate" }], a.countdown.loaders.map((l) => [l.name, s3(l.seconds), l.approx ? "yes" : null]))],
    });
  const as = a.countdown.assets;
  if (as) {
    const loader = as.loader === "FastLoader" ? "KSPCF's FastLoader" : "stock GameDatabase";
    const counted = as.files.length - (as.concurrentAudio?.files ?? 0);
    const notes = [`${loader}: ${counted} files timed one by one, ${as.seconds.toFixed(1)} s on the main thread, from each file's Load line to the next.`];
    if (as.reported) notes.push(`FastLoader reports ${as.reported.files} assets in ${as.reported.seconds.toFixed(1)} s (KSP.log:${as.reported.line.n}).`);
    if (as.concurrentAudio?.files)
      notes.push(`${as.concurrentAudio.files} audio clips (${as.concurrentAudio.seconds.toFixed(1)} s) load concurrently, so their time is left out of the groups.`);
    const groupCols = (t: string) => [{ title: t }, { title: "Files", digits: 0 }, SECONDS];
    sections.push({ title: "Assets by folder", from: ["log"], note: notes.join(" "), blocks: [table(groupCols("GameData folder"), as.byFolder.map((g) => [g.key, g.files, s3(g.seconds)]))] });
    sections.push({ title: "Assets by format", from: ["log"], blocks: [table(groupCols("Format"), as.byFormat.map((g) => [g.key, g.files, s3(g.seconds)]))] });
    const files = as.files.filter((f) => !(as.concurrentAudio && f.kind === "audio")).sort((x, y) => y.seconds - x.seconds);
    sections.push({
      title: "Every asset file",
      from: ["log"],
      note: "Slowest first. Each file's time is the gap to the next load line in KSP.log, so it includes whatever else ran in between.",
      blocks: [table([{ title: "Folder" }, { title: "File", wrap: true }, { title: "Format" }, { title: "ms", digits: 1 }, { title: "Log line", digits: 0 }], files.map((f) => [f.folder, f.url, f.format, ms(f.seconds * 1000), f.line.n]))],
    });
  }
  const longFrames = (a.longFrames ?? []).filter((f) => f.phase === "countdown");
  if (longFrames.length) sections.push({ title: "Long frames", from: ["profiler", "log"], note: FRAMES_NOTE, blocks: [frames(longFrames)] });
  return { id: "raw-countdown", title: "Countdown", gloss: "startup time", note: "From launching KSP to the main menu.", sections };
}

function holdsGroup(a: RunAnalysis): RawGroup {
  const sections: RawSection[] = [];
  if (a.holds.length)
    sections.push({
      title: "Scene transitions",
      from: ["profiler", "log"],
      open: true,
      note: "Profiler: from the scene request to the scene's first frame. ShowUI: from the scene request to KSP's ShowUI line, without the profiler.",
      blocks: [table([{ title: "#", digits: 0 }, { title: "Transition" }, SECONDS, { title: "Measured by" }], a.holds.map((h, i) => [i + 1, holdName(h.label), s3(h.seconds), h.source]))],
    });
  for (const e of a.flightEntries)
    sections.push({ title: `Flight entry phases: ${holdName(e.label)}`, from: ["log"], note: "Entering Flight cut at the log lines that mark each step.", blocks: [phases(e.phases, false)] });
  const longFrames = (a.longFrames ?? []).filter((f) => f.phase !== "countdown");
  if (longFrames.length) sections.push({ title: "Long frames", from: ["profiler", "log"], note: FRAMES_NOTE, blocks: [frames(longFrames)] });
  if (a.slowEvents.length)
    sections.push({
      title: "Slowest single GameEvent dispatches",
      from: ["profiler"],
      note: "One dispatch of a GameEvent: every subscribed handler, run back to back.",
      blocks: [table([{ title: "GameEvent" }, MS], a.slowEvents.map((e) => [e.event, ms(e.ms)]))],
    });
  return { id: "raw-holds", title: "Holds", gloss: "scene transitions", note: "Each change of scene after the main menu, in the order played.", sections };
}

function sessionGroup(a: RunAnalysis): RawGroup {
  return {
    id: "raw-session",
    title: "Whole session",
    gloss: "profiler totals",
    note: "Totals per class, module or event, summed over the run: the Countdown and every Hold together.",
    sections: a.aggregates.map((f) => {
      const [title, note] = FAMILY[f.family] ?? [f.family, ""];
      return { title: `${title} (${f.family})`, from: ["profiler"], ...(note ? { note } : {}), blocks: [table([{ title: "Key", wrap: true }, MS], f.entries.map((e) => [e.key, ms(e.ms)]))] };
    }),
  };
}

function findingsGroup(a: RunAnalysis): RawGroup {
  const findings: RawFinding[] = a.findings.map((f) => ({
    id: f.id,
    title: f.title,
    ...(f.subject !== undefined ? { subject: f.subject } : {}),
    place: f.where.phase === "session" ? "whole session" : placeName(f.where),
    ...(f.cost.seconds !== undefined ? { seconds: s3(f.cost.seconds) } : {}),
    cost: f.cost.kind,
    confidence: f.confidence,
    informational: Boolean(f.informational),
    ...(f.within !== undefined ? { within: f.within } : {}),
    method: f.cost.method,
    action: f.action,
    notes: f.notes ?? [],
    evidence: f.evidence.map((e) => ({ source: e.source, ...(e.line !== undefined ? { line: e.line } : {}), text: e.text })),
  }));
  return {
    id: "raw-findings",
    title: "Findings",
    gloss: "as the analyzer wrote them",
    note: "Every finding with its rule id, cost method and every evidence line. The other tabs summarize these.",
    sections: [{ title: `All ${findings.length} findings`, from: ["analyzer"], blocks: [{ kind: "findings", findings }] }],
  };
}

/** Every string through the redactor; numbers and structure as they are. */
function redactAll<T>(value: T, redact: (s: string) => string): T {
  if (typeof value === "string") return redact(value) as T;
  if (Array.isArray(value)) return value.map((v) => redactAll(v, redact)) as T;
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redactAll(v, redact)])) as T;
  return value;
}

export function buildRaw(a: RunAnalysis): RawGroup[] {
  const groups = [runGroup(a), countdownGroup(a), holdsGroup(a), sessionGroup(a), findingsGroup(a)].filter((g) => g.sections.length);
  return redactAll(groups, redactor(a.identifying));
}
