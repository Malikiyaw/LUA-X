# Phase 9 — Autonomous Game Builder

## Status

**Core implemented.**

Phase 9 introduces a bounded autonomous build director that coordinates the capabilities created in earlier phases.

## Architecture

```text
High-level creator goal
        ↓
Acceptance criteria
        ↓
Dependency-aware work graph
        ↓
Specialist agents
        ↓
Reviewable change sets
        ↓
Approval gate
        ↓
Studio execution
        ↓
Verification
        ↓
Targeted repair (bounded)
        ↓
Regression verification
        ↓
Evidence-backed completion
```

## Core guarantees

### Dependency safety

Work items cannot execute until declared dependencies are complete. Unknown dependencies and self-dependencies are rejected.

### Approval safety

A plan enters `awaiting_approval` before execution. The autonomous engine cannot skip the existing mutation approval layer.

### Bounded repair

Repair attempts have a configurable maximum. Exhausting the budget blocks the build instead of creating an infinite autonomous mutation loop.

### Evidence-backed completion

A build cannot enter `completed` without verification evidence.

### Existing-project preservation

The autonomous prompt explicitly requires incremental changes and preservation of unrelated creator-authored systems.

## State machine

```text
draft
  ↓
planning
  ↓
awaiting_approval
  ↓
executing
  ↓
verifying
  ├── completed
  └── repairing
       ├── executing
       └── blocked
```

## What is intentionally not claimed complete

The autonomous core does not itself provide a live Roblox Studio session, an AI model provider, asset marketplace access, or real playtest execution. Those remain external integrations handled by the existing provider and Studio adapter layers.

## Production definition of done

Phase 9 becomes production-complete when a real connected Studio session can execute a multi-system plan, collect verification evidence, repair a verified failure within the bounded budget, rerun regressions, and produce an auditable final build report.
