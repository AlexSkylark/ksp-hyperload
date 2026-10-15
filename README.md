# T-Minus

Startup and scene-transition diagnostics for **Kerbal Space Program 1** (1.12.5).

T-Minus measures where loading time goes on a heavily modded install: the
startup **Countdown** and every scene-transition **Hold**. It tells you which
mods cost how much, and what you can do about it.

## Status

**Early development. Nothing to install yet.**

- The in-game profiler works and has been validated on a 180-mod install.
- A command-line analyzer turns `KSP.log` and the profiler's output into a
  report that leads with diagnosed problems, each with its cost, evidence and
  a suggested action. It has been checked only against our own test runs so
  far.

## How it works

- **In-game profiler** (optional mod). Records what the log cannot show: the
  time each mod's addons and parts take, and the exact boundaries of the
  Countdown and each Hold.
- **Analyzer.** Reads `KSP.log`, plus the profiler's output when it is
  there, and reports where the time went. `KSP.log` alone already covers the
  largest problems. A web version that runs entirely in your browser is
  planned, so logs never leave your machine.

T-Minus does not speed anything up by itself. Loading optimizations belong to
[KSPCommunityFixes](https://github.com/KSPModdingLibs/KSPCommunityFixes) and
[ModuleManager](https://github.com/sarbian/ModuleManager): T-Minus measures
and explains them, and points you to the setting, the mod or the patch that
is costing you time.

## Design principles

- **Measuring never changes the game.** Every hook only times code, and every
  hook group can be turned off.
- **Coexist, don't duplicate.** T-Minus works alongside KSPCommunityFixes and
  ModuleManager, not instead of them.
- **Honest numbers.** Measured and inferred values are labeled as such.
- **Privacy.** Logs contain usernames and paths. They are processed locally.

## What's in the repo

| Path | What |
|---|---|
| [`src/TMinus`](src/TMinus) | The in-game profiler (C#, .NET Framework 4.7.2) |
| [`tools/analyze`](tools/analyze) | The analyzer (TypeScript, Node 24) |
| [`docs/design.md`](docs/design.md) | Design and roadmap |

## License

[MIT](LICENSE)
