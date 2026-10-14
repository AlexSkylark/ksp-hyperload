# HyperLoad

A runtime optimization framework for **Kerbal Space Program 1** (1.12.5).

HyperLoad aims to reduce startup and scene transition times on heavily modded
installs, **without requiring changes to existing mods**. Instead of
micro-optimizing individual load steps, it avoids repeating work: caching what
never changes, keeping long-lived services alive across scenes, and only
rebuilding state that actually needs rebuilding.

> *The fastest loading operation is the one that never has to occur.*

## Status

**Early development. Nothing to install yet.**

The project is in its setup phase. The first milestone is a profiler that
measures where loading time actually goes; optimizations come only after
the data shows what they are worth.

## Design principles

- **Compatibility first.** Unknown situations fall back to vanilla behavior.
- **Every optimization is optional** and disables itself when unsafe.
- **Measure before optimizing.**
- **Coexist, don't duplicate.** HyperLoad is designed to work alongside
  [ModuleManager](https://github.com/sarbian/ModuleManager) and
  [KSPCommunityFixes](https://github.com/KSPModdingLibs/KSPCommunityFixes),
  not replace them.

See [docs/proposal.md](docs/proposal.md) for the full design.

## License

[MIT](LICENSE)
