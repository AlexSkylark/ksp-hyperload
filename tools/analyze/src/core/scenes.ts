// KSP's scenes as players know them, for every text a player reads.

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
