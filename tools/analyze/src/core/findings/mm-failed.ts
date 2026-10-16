// ModuleManager failed: a fatal error stopped its patching.
//
// [C] When MM's patching or logging thread exits with an exception, or the
// patcher returns no configs, MMPatchRunner logs it, shows a fatal-error
// dialog asking to close KSP, and stops: the database is never patched and
// the Countdown does not finish normally (MMPatchRunner). The lines
// are in the timeline, not the dump (docs/mechanisms.md, area 1
// candidate rules). No cost: the startup never completes.

import type { Run } from "../run.js";
import type { Finding, Rule } from "./types.js";

const FATAL = /^\[ModuleManager\] (The patching thread threw an exception|The logging thread threw an exception|The patcher returned a null collection of configs)/;

export const mmPatchingFailed: Rule = {
  id: "mm-patching-failed",
  needs: "log",
  detects: "a fatal ModuleManager error",
  run(run: Run): Finding[] {
    const line = run.log.find((l) => FATAL.test(l.text));
    if (!line) return [];
    const what = FATAL.exec(line.text)![1];
    return [
      {
        id: this.id,
        title: `ModuleManager failed: ${what.charAt(0).toLowerCase()}${what.slice(1)}`,
        subject: "ModuleManager",
        mods: [{ name: "ModuleManager", role: "culprit" }],
        where: { phase: "countdown" },
        cost: { kind: "not-measured", method: "ModuleManager stops and asks to close KSP, so the startup does not complete" },
        evidence: [{ source: "log", line: line.n, text: [line.text, ...(line.more ?? []).slice(0, 5).map((m) => m.text)].join("\n") }],
        action:
          "Nothing downstream of this is reliable. Read the exception in the evidence: it usually names the mod or file involved. Check that only one ModuleManager DLL is installed and that it is the version made for KSP 1.12, then report the exception to ModuleManager or to the mod it names.",
        cause: "a ModuleManager failure",
        remedy: "fix",
        confidence: "measured",
      },
    ];
  },
};
