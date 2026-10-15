# T-Minus

Startup and scene-transition diagnostics for **Kerbal Space Program 1** (1.12.5).

T-Minus measures where loading time goes on a heavily modded install: the
startup **Countdown** and every scene-transition **Hold**. It aims to tell
you which mods cost how much, and what you can do about it.

## Status

**Early development. Nothing to install yet.**

The in-game profiler works and has been validated on a 180-mod install. The
player-facing report is not built yet.

The project was called **HyperLoad** until 2026-10-15, when it began as a
runtime optimization framework. Measurements showed that the time a mod like
this could save on its own is small. Most of the cost comes from what
individual mods do, and
[KSPCommunityFixes](https://github.com/KSPModdingLibs/KSPCommunityFixes)
already covers the stock targets. Finding the culprits on each install turned
out to be the useful part, so the project now focuses on diagnostics.

## Design principles

- **Compatibility first.** Measuring must never change how the game behaves.
  Every hook group can be turned off.
- **Coexist, don't duplicate.** T-Minus works alongside
  [ModuleManager](https://github.com/sarbian/ModuleManager) and
  KSPCommunityFixes, not instead of them.

## License

[MIT](LICENSE)
