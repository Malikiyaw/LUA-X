# Phase 4 — AI Code Builder & Safe Execution

## Goal

Turn a verified execution brief into a reviewable Luau change set and safely apply it through a Roblox Studio adapter.

Phase 4 deliberately separates **generation** from **mutation**:

```text
User intent
  ↓
Execution brief
  ↓
Relevant project context
  ↓
AI code builder
  ↓
Strict output validation
  ↓
Change set
  ↓
Risk + approval gate
  ↓
Studio execution adapter
  ↓
Evidence
  ↓
Verification
```

## Core components

### Code model adapter

`CodeModel` is provider-neutral. LUA-X does not depend on a specific model vendor. A provider adapter receives a system prompt and compiled project context and returns structured output.

### Output validator

Model output is untrusted data. The validator rejects:

- malformed JSON
- unknown operation kinds
- invalid Roblox targets
- missing reasons
- invalid risk levels
- missing script content

No validated change set means no mutation.

### Change-set engine

Every generated operation receives:

- deterministic change-set identity
- operation ID
- target
- operation type
- reason
- risk
- optional expected target hash

### Approval policy

Default behavior:

- low-risk operations can run through the configured execution path
- medium/high/critical operations require explicit change-set approval
- script deletion is disabled unless explicitly enabled

The policy is intentionally stricter than a generic coding agent because a Roblox place is a stateful project and a bad mutation can destroy working content.

### Stale-write protection

Replace operations may include an `expectedHash`. Before applying the operation, the adapter reads the current target. If it has changed since planning, LUA-X refuses to overwrite it.

This prevents an old AI plan from silently replacing newer creator work.

## What is implemented

- execution-engine package
- model-provider interface
- project-context prompt builder
- strict JSON/output validation
- structured code operations
- deterministic change sets
- approval policy
- delete protection
- stale-write protection
- dry-run adapter
- automated safety tests

## What is intentionally deferred

The execution engine does not pretend to be a live Roblox Studio connection. The real mutation adapter belongs to the Studio MCP integration boundary and must be tested against an actual Studio session.

Roblox's current Studio MCP server provides script reading, multi-edit, search, grep, Luau execution, playtesting, console output, Data Model exploration, and other tools through a local stdio process. LUA-X should use that official interface rather than inventing a parallel mutation protocol. citeturn0search0

## Example lifecycle

Creator:

> Add a secure round system with a server timer and a HUD countdown.

LUA-X:

1. Retrieves round and UI context.
2. Routes to Architect, Luau, UI, Security, and Playtest specialists.
3. Generates a dependency-aware plan.
4. Generates structured code operations.
5. Validates every operation.
6. Creates a reviewable change set.
7. Requests approval for risky writes.
8. Applies approved operations through the Studio adapter.
9. Collects tool evidence.
10. Runs verification.
11. Repairs only the failed surface when possible.

## Quality gate

Phase 4 is considered complete only when a real provider and a real Studio adapter have been tested end-to-end. The current repository contains the safe execution core; live-provider and live-Studio validation remain integration work rather than being falsely marked as complete.
