# HyperLoad

> **Historical document.** Written when this project was called HyperLoad
> (renamed to T-Minus on 2026-10-15). Names, paths and log tags below use the
> old name.

## Runtime Optimization Framework for Kerbal Space Program

**Project Proposal / Technical Design Document**

------------------------------------------------------------------------

# Executive Summary

HyperLoad is a runtime optimization framework for Kerbal Space Program
designed to reduce startup times, scene transition times, and
unnecessary runtime overhead **without requiring changes to existing
mods**.

Rather than relying on isolated micro-optimizations, HyperLoad
introduces a persistence-oriented runtime architecture centered around
intelligent caching, persistent services, selective object residency,
and compatibility-first lifecycle management.

> **Guiding principle:** *The fastest loading operation is the one that
> never has to occur.*

------------------------------------------------------------------------

# Problem Statement

KSP rebuilds significant portions of its runtime during every scene
transition.

Typical lifecycle:

``` text
Unload Scene
↓
Destroy Scene Objects
↓
Destroy Runtime State
↓
Load New Scene
↓
Rebuild Runtime Structures
↓
Initialize Plugins
↓
Player Regains Control
```

On heavily modded installs, this repeated work can account for tens of
seconds of waiting.

------------------------------------------------------------------------

# Vision

Transform the lifecycle from:

``` text
Create
↓
Destroy
↓
Create
↓
Destroy
```

into:

``` text
Initialize
↓
Hibernate
↓
Wake
↓
Hibernate
↓
Wake
```

Only runtime state that genuinely needs reconstruction should ever be
rebuilt.

------------------------------------------------------------------------

# Goals

## Primary Goals

-   Reduce startup time.
-   Reduce scene transition times.
-   Eliminate repeated initialization.
-   Preserve compatibility with existing mods.
-   Provide comprehensive profiling.
-   Create reusable runtime infrastructure.

## Secondary Goals

-   Reduce GC pressure.
-   Reduce reflection overhead.
-   Reduce repeated config parsing.
-   Improve memory utilization.
-   Enable asynchronous initialization.

------------------------------------------------------------------------

# Non-Goals

-   Gameplay changes.
-   Replacing ModuleManager.
-   Replacing Community Fixes.
-   Rewriting Unity.
-   Modifying save formats.
-   Requiring third-party mods to integrate with HyperLoad.

------------------------------------------------------------------------

# Design Philosophy

1.  Compatibility First
2.  Progressive Enhancement
3.  Measure Before Optimizing
4.  Persistence Over Reconstruction
5.  Graceful Degradation

------------------------------------------------------------------------

# High-Level Architecture

``` text
HyperLoad
├── Runtime Profiler
├── Cache Manager
├── Persistent Services
├── Scene Residency Manager
├── Object Residency Manager
├── Memory Manager
├── Async Initialization
├── Plugin Scheduler
├── Compatibility Layer
├── Diagnostics
└── Public API
```

------------------------------------------------------------------------

# Core Components

## Runtime Profiler

Collects timing data for:

-   Scene loading
-   Plugin initialization
-   Reflection
-   Cache construction
-   Garbage collection
-   Memory usage

------------------------------------------------------------------------

## Cache Manager

Persistent caches for:

-   Reflection
-   Config lookups
-   Localization
-   Dictionaries
-   Metadata
-   Search indexes

------------------------------------------------------------------------

## Persistent Services

Long-lived runtime services that should never require reconstruction.

Examples:

-   Part indexes
-   Editor category trees
-   Thumbnail databases
-   Localization services

------------------------------------------------------------------------

## Scene Residency Manager

Maintains selected scenes in memory.

Possible states:

-   Preparing
-   Active
-   Dormant
-   Evicting
-   Destroyed

------------------------------------------------------------------------

## Object Residency Manager

Rather than preserving entire scenes, HyperLoad preserves compatible
object graphs.

Responsibilities:

-   Freeze compatible objects
-   Wake dormant objects
-   Dependency tracking
-   Safety validation

------------------------------------------------------------------------

## Memory Manager

Responsibilities:

-   Residency budget
-   LRU eviction
-   Memory pressure monitoring
-   Automatic cleanup

------------------------------------------------------------------------

## Async Initialization

Allows non-critical systems to initialize after the player regains
control.

------------------------------------------------------------------------

## Plugin Scheduler

Coordinates plugin initialization through:

-   Lazy initialization
-   Deferred initialization
-   Priority scheduling

------------------------------------------------------------------------

## Compatibility Layer

Responsible for:

-   Harmony patches
-   Feature detection
-   Compatibility database
-   Automatic fallbacks

------------------------------------------------------------------------

## Diagnostics

Provides:

-   Live timings
-   Cache statistics
-   Resident scenes
-   Resident services
-   Memory usage
-   Plugin timings

------------------------------------------------------------------------

# Compatibility Strategy

Optimization levels:

-   **Level 0** -- Immutable caches (always safe)
-   **Level 1** -- Persistent services (very safe)
-   **Level 2** -- Object residency (validated)
-   **Level 3** -- Scene residency (experimental)
-   **Level 4** -- Unsafe optimizations (disabled)

Unknown situations always fall back to vanilla behavior.

------------------------------------------------------------------------

# Development Roadmap

## Phase 1

Profiler and benchmarking.

## Phase 2

Persistent caches.

## Phase 3

Persistent services.

## Phase 4

Object residency.

## Phase 5

Scene residency.

## Phase 6

Advanced scheduling, predictive loading and memory management.

------------------------------------------------------------------------

# Risk Assessment

## Unity Engine Constraints

HyperLoad cannot replace Unity's scene lifecycle or GPU resource
management. It must work around engine limitations.

## Compatibility Risks

Some mods rely on Unity lifecycle callbacks such as `Awake()`, `Start()`
and `OnDestroy()`. Advanced optimizations must only be applied when
safety can be demonstrated.

## Memory Trade-Offs

Keeping runtime state resident increases RAM usage. HyperLoad must
implement configurable memory budgets and LRU eviction.

## Stability First

Every optimization must be optional and individually disable itself when
unsafe.

## Incremental Delivery

Every development phase should produce a stable, independently useful
release.

------------------------------------------------------------------------

# Long-Term Vision

HyperLoad is intended to become the runtime orchestration layer for
Kerbal Space Program, replacing repeated destruction and reconstruction
with persistence, intelligent caching, selective residency, and
compatibility-first lifecycle management.

The long-term objective is to make heavily modded KSP installations feel
substantially more responsive without requiring changes to the existing
mod ecosystem.
