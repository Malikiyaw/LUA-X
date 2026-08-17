# LUA-X Implementation Phases

This document turns the product roadmap into an execution sequence. We build and verify one vertical slice at a time instead of creating a huge unfinished shell.

## Phase 0 — Engineering Foundation

**Definition of done:** the repository can run locally, validate code, and support the first end-to-end request flow.

Deliver:
- monorepo/workspace structure
- shared TypeScript schemas
- environment configuration
- lint/format/typecheck/test setup
- web shell
- API shell
- structured logging
- provider adapter interface
- health endpoint
- CI checks

## Phase 1 — Project Intelligence

**Definition of done:** LUA-X can inspect a connected Roblox project and build a searchable project model.

Deliver:
- project manifest
- Data Model tree representation
- script/module inventory
- symbol/reference index
- RemoteEvent/RemoteFunction inventory
- service usage inventory
- project convention extraction
- context retrieval API
- project memory schema

Verification:
- known project facts can be retrieved accurately
- irrelevant files are excluded from targeted context
- stale index states are detectable

## Phase 2 — Prompt Compiler + Orchestrator

**Definition of done:** a creator request becomes a structured execution brief and routes to the right specialist.

Deliver:
- intent parser
- complexity classifier
- context selector
- execution-brief compiler
- agent router
- task dependency graph
- model/provider abstraction
- structured model output validation

Verification:
- same project context produces consistent briefs
- specialist selection matches task type
- malformed model output cannot directly mutate a project

## Phase 3 — Change Set Engine

**Definition of done:** agents can propose, review, apply, and roll back controlled project changes.

Deliver:
- file patch representation
- Data Model mutation representation
- diff viewer
- approval gate
- apply engine
- checkpoints
- rollback
- audit log

Verification:
- rejected changes are never applied
- rollback restores the previous known state
- unrelated files remain unchanged

## Phase 4 — Roblox Studio Bridge

**Definition of done:** LUA-X can safely communicate with an installed Roblox Studio plugin and synchronize project information.

Roblox Studio is the authoritative development environment. The official documentation confirms Studio supports building, scripting, testing, publishing, and Data Model manipulation, while plugins provide Studio UI/actions. citeturn0search2turn0search3

Deliver:
- Studio plugin scaffold
- authentication/pairing
- local connection protocol
- project snapshot
- selection sync
- script read/write
- Data Model read/write
- command acknowledgements
- connection health
- explicit permission boundaries

Important:
- Do not assume every Studio API is available to a plugin.
- Respect Roblox plugin security/capability boundaries.
- Treat tool permissions as explicit capabilities rather than unrestricted execution. Roblox documents plugin capabilities and security capabilities separately. citeturn0search1turn0search5

## Phase 5 — AI Code Builder

**Definition of done:** a user can request a real gameplay feature, review the generated change set, apply it to Studio, and verify it.

Deliver:
- Luau specialist
- code search/retrieval
- architecture-aware generation
- test generation
- error parser
- repair loop
- Studio output integration
- code review panel

Golden test:
> Add a server-authoritative coin collection system to an existing project without breaking its current UI or save system.

## Phase 6 — Animation Studio

**Definition of done:** a creator can describe an animation, receive an editable animation plan/artifact through the connected toolchain, preview it, and integrate it with gameplay.

Deliver:
- rig detection
- animation intent parser
- pose/timing representation
- timeline UI
- keyframe editing model
- animation specialist
- gameplay marker model
- animation preview bridge
- integration assistant
- validation

Do not fabricate uploaded/published AnimationIds. Only display an asset ID after a connected Roblox workflow confirms it.

## Phase 7 — UI Studio

**Definition of done:** creators can generate and edit Roblox UI while keeping it connected to real gameplay state.

Deliver:
- UI tree inspector
- visual layout editor
- component generator
- style memory
- responsive rules
- interaction-state generator
- Luau wiring
- preview
- regression checks

## Phase 8 — World Studio

**Definition of done:** creators can plan and build organized scenes/world systems through connected Roblox tooling.

Deliver:
- scene planner
- hierarchy operations
- asset reference system
- placement workflows
- world rules
- collision checks
- traversal checks
- performance checks

## Phase 9 — Verification + Playtesting

**Definition of done:** LUA-X can prove whether generated work satisfies acceptance criteria.

Deliver:
- test scenario builder
- static checks
- runtime checks
- Studio playtest integration
- regression suite
- performance checks
- security audit
- evidence store
- automatic repair loop

## Phase 10 — Autonomous Build Mode

**Definition of done:** the user can provide a multi-system goal, approve a dependency-aware plan, and let LUA-X execute and verify it with checkpoints.

Example goal:
> Build a round-based survival experience with a lobby, progression, currency, shop, enemy waves, boss encounters, UI, animations, persistence, and analytics.

LUA-X should:

1. inspect the existing project
2. decompose the goal
3. identify dependencies
4. produce an implementation plan
5. request approval for meaningful mutations
6. execute specialist tasks
7. verify each milestone
8. repair failures
9. produce a final change set and evidence report

## Phase 11 — Production Hardening

**Definition of done:** LUA-X is reliable enough for real creators and projects.

Deliver:
- rate limiting
- secrets management
- model cost controls
- telemetry
- crash recovery
- job cancellation
- resumable tasks
- permission system
- workspace isolation
- backups
- abuse prevention
- privacy controls
- provider failover

## Completion rule

A phase is **not complete because the UI exists**. It is complete when its core workflow works against a real project, has automated tests, handles failure, and produces evidence.

## Recommended build order

```text
0 Foundation
  ↓
1 Project Intelligence
  ↓
2 Prompt Compiler
  ↓
3 Change Sets
  ↓
4 Studio Bridge
  ↓
5 Code Builder
  ↓
6 Animation
  ↓
7 UI
  ↓
8 World
  ↓
9 Verification
  ↓
10 Autonomous Mode
  ↓
11 Production Hardening
```
