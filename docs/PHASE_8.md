# Phase 8 — Verification & Playtest Intelligence

## Status

**Core implemented.**

Phase 8 makes verification a first-class LUA-X subsystem. AI output is never treated as proof that a feature works.

## Architecture

```text
Change set
  ↓
Acceptance criteria
  ↓
Test planner
  ↓
Static / unit / integration / playtest / multiplayer / performance / security
  ↓
Evidence collector
  ↓
Evaluator
  ├── PASS → regression + final report
  └── FAIL → failure classification
                ↓
             repair plan
                ↓
             targeted change
                ↓
             rerun
```

## Core concepts

### Acceptance criteria

Each feature has explicit criteria. Required criteria cannot be silently skipped.

### Test cases

Tests are typed by layer and have deterministic IDs, steps, expected outcomes, and priorities.

### Evidence

Evidence can originate from assertions, console output, runtime results, screenshots, metrics, or connected tools.

### Failure classification

Failures are classified into build, runtime, logic, integration, visual, security, performance, or environment categories.

### Repair planning

Recoverable code/system failures produce targeted repair plans. Environment failures are retried before modifying code. Non-recoverable failures escalate instead of allowing an autonomous destructive loop.

## Safety rules

- Never invent test results.
- Never claim a screenshot or metric exists without tool evidence.
- Never treat model confidence as verification.
- Never change code solely because a tool environment failed.
- Security failures require conservative handling.
- Client/server features require appropriate authority-boundary tests.

## Production completion criteria

Phase 8 becomes production-complete when the real Studio bridge can execute the generated tests, capture actual runtime/console/screenshot evidence, run multiplayer scenarios where required, measure relevant performance, apply verified repairs, and produce an auditable final report.
