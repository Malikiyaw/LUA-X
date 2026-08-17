# Phase 6 — UI Studio

## Status

**Core implemented.**

Phase 6 introduces a structured UI engine that represents Roblox interfaces as editable specifications instead of opaque model output.

## Architecture

```text
Creator intent
  ↓
Project UI context
  ↓
UI specialist
  ↓
UIScreenSpec
  ↓
Hierarchy + theme + responsive rules + interaction states
  ↓
Validation
  ↓
Change set
  ↓
Roblox Studio adapter
  ↓
Preview / playtest
```

## Core model

`UIScreenSpec` contains:
- stable screen/root IDs
- component hierarchy
- component kinds
- parent relationships
- layout metadata
- style metadata
- interaction states
- action contracts
- theme tokens
- responsive rules

## Validation

The core validator rejects malformed identity, duplicate IDs, missing parents, missing roots, invalid transparency, and invalid text sizes. It also warns when an interactive button has no disabled state.

## Safety

The UI engine does not execute arbitrary model output. The structured specification must pass validation before it becomes a candidate change set. Gameplay actions remain contracts to existing systems; authoritative state must remain server-owned.

## Follow-up editing

UI edits should be incremental. A request to change one component should preserve unrelated components and behavior.

## Remaining integration

The following are intentionally not marked complete until tested against a real Studio session:

- live Data Model → UI import
- Studio UI instance creation/update
- live preview synchronization
- screenshot/visual verification
- gameplay event binding in a real place
- responsive playtesting across target resolutions

## Definition of done for production

Phase 6 becomes production-complete when a connected Studio session can create/update the structured UI, preview it, run the relevant gameplay flow, collect evidence, and safely roll back the generated change set.
