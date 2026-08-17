# Phase 7 — World Studio

## Status

**Core implemented.**

Phase 7 adds a structured world-planning engine for Roblox environments. It represents scene intent as editable data so AI can make targeted changes instead of regenerating an entire map.

## Core model

`WorldSpec` contains:
- assets and transforms
- world zones
- landmarks and priorities
- traversal/path nodes
- performance budgets
- streaming regions
- visual design tokens
- density and mood

## Validation

The validator checks:
- world identity
- duplicate IDs
- transforms and vectors
- negative scale
- zone bounds
- inverted bounds
- landmark positions
- missing path-node references
- instance budgets
- streaming configuration

## Architecture

```text
Creator intent
  ↓
Project/world context
  ↓
World specialist
  ↓
WorldSpec
  ↓
Validation
  ↓
Change set
  ↓
Studio bridge
  ↓
Preview / playtest
  ↓
Collision + navigation + performance verification
```

## Design philosophy

World generation must understand gameplay space, not only appearance. Landmarks, traversal, combat zones, objectives, safe areas, sightlines, collision and performance are first-class constraints.

## Incremental editing

World edits are intended to be surgical. Existing gameplay-critical content should survive unrelated visual edits. Future change-set operations will use stable IDs and target hashes so stale AI plans cannot silently overwrite newer creator changes.

## Remaining integration

The following are intentionally pending until tested with a real Roblox Studio session:

- live Data Model import/export
- real Instance/model placement
- terrain editing adapter
- asset insertion through supported Studio tooling
- navigation/pathfinding verification
- collision playtesting
- screenshot/visual verification
- performance measurement
- live rollback

## Production definition of done

Phase 7 becomes production-complete when a connected Studio session can safely create/update the planned world, preview it, run relevant gameplay scenarios, collect verification evidence, and roll back the generated change set.
