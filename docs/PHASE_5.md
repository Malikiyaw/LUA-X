# Phase 5 — Animation Studio Core

## Objective

Make animation a first-class, editable artifact in LUA-X instead of treating it as opaque AI output.

## What is implemented

The `@lua-x/animation-engine` package provides a provider-neutral animation data model for:

- rig type (`R6`, `R15`, or unknown)
- clip metadata
- duration and looping
- joint keyframes
- interpolation modes
- timeline markers
- gameplay/fx/audio/custom marker categories
- deterministic sorting
- validation and warnings
- numeric interpolation helpers

## Safety and correctness

The engine does not invent Roblox animation asset IDs and does not claim that an animation has been uploaded or published. Those actions require a connected Roblox toolchain and evidence from that toolchain.

Timeline values are validated against clip duration. Invalid keyframes/markers are rejected by validation. Duplicate marker names are surfaced as warnings because duplicate names may be intentional in some event systems but should be reviewed before gameplay integration.

## Planned Studio integration

The next layer will connect this artifact model to the real Roblox Studio workflow:

1. Detect the selected rig.
2. Read the current animation/editor state through the available Studio integration.
3. Translate an animation intent into an editable clip.
4. Apply keyframes/markers through supported Studio operations.
5. Preview/playtest the animation.
6. Capture evidence.
7. Store the resulting change set.

## AI animation workflow

```text
Creator intent
      ↓
Animation Director
      ↓
Motion specification
      ↓
Pose/timing plan
      ↓
Animation Clip artifact
      ↓
Validation
      ↓
Studio adapter
      ↓
Preview
      ↓
Gameplay integration
      ↓
Playtest
      ↓
Evidence
```

## Why this architecture matters

The animation artifact is deliberately separate from the AI provider. This lets LUA-X change models without changing the animation system and lets creators edit/refine an existing animation without regenerating the entire result.

## Not falsely marked complete

The following require a real Studio integration and are not claimed as complete by Phase 5 Core:

- real keyframe insertion into Studio
- real rig extraction from a live Studio session
- animation editor synchronization
- publishing/uploading an animation
- visual preview evidence from Studio
- end-to-end AI-to-Studio animation generation

These are integration tasks, not things that should be simulated in the core package.
