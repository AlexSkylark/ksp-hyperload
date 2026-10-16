// Words the renderers share: scene and Hold names, places, input levels.

import type { InputLevel, Where } from "../core/findings/index.js";

/** KSP's GameScenes, as players know them. */
const SCENES: Record<string, string> = {
  LOADING: "Loading",
  LOADINGBUFFER: "Loading buffer",
  MAINMENU: "Main menu",
  SETTINGS: "Settings",
  CREDITS: "Credits",
  SPACECENTER: "Space Center",
  EDITOR: "Editor",
  FLIGHT: "Flight",
  TRACKSTATION: "Tracking Station",
  PSYSTEM: "Planetary system",
  MISSIONBUILDER: "Mission Builder",
};

export const sceneName = (scene: string) => SCENES[scene] ?? scene;

/** "EDITOR->FLIGHT" → "Editor → Flight". */
export const holdName = (label: string) => label.split("->").map(sceneName).join(" → ");

/** A place in plain words: "the Countdown", "Editor → Flight", "between Holds", "the Holds". */
export function placeName(w: Where): string {
  if (w.phase === "countdown") return "the Countdown";
  if (w.phase === "hold") return w.hold ? holdName(w.hold) : "the Holds";
  return "between Holds";
}

export const LEVEL_NAME: Record<InputLevel, string> = {
  log: "KSP.log only",
  "log+summary": "KSP.log with T-Minus' summary",
  "log+profiler": "KSP.log and T-Minus' profiler records",
};

/** How the Countdown's seconds were obtained. */
export const COUNTDOWN_SOURCE = {
  profiler: "from process start to the main menu's first frame (T-Minus' profiler)",
  log: "from the log's first line to the main menu's first frame (KSP.log; the game's start before its first line is not in it)",
} as const;

/** "1.2 s"; "< 0.1 s" under a twentieth of a second. */
export const seconds = (s: number) => (s < 0.05 ? "< 0.1 s" : `${s.toFixed(1)} s`);
