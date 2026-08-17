# LUA-X Roadmap

## Phase 0 — Foundation

- [x] Establish product thesis
- [x] Define project-aware prompt architecture
- [x] Define agent roles
- [x] Define verification-first workflow
- [ ] Select implementation stack
- [ ] Create monorepo structure
- [ ] Add CI and type/lint/test gates
- [ ] Build local development environment

## Phase 1 — Project Intelligence

Goal: LUA-X can understand a Roblox project before changing it.

- [ ] Roblox project ingestion
- [ ] Data Model / hierarchy index
- [ ] Luau symbol index
- [ ] dependency graph
- [ ] RemoteEvent / RemoteFunction map
- [ ] service usage map
- [ ] asset references map
- [ ] project conventions memory
- [ ] architecture summary
- [ ] safe change planner

## Phase 2 — AI Engineering Core

Goal: turn natural language into controlled, reviewable changes.

- [ ] Master prompt compiler
- [ ] task decomposition
- [ ] specialist agent router
- [ ] file/instance patch planner
- [ ] code generation
- [ ] code review
- [ ] repair loop
- [ ] change-set preview
- [ ] rollback
- [ ] project memory

## Phase 3 — Roblox Studio Bridge

Goal: connect the browser workspace to real Roblox projects.

- [ ] Studio plugin
- [ ] authenticated project pairing
- [ ] project sync protocol
- [ ] command execution bridge
- [ ] Data Model read/write operations
- [ ] Luau script operations
- [ ] test/playtest bridge
- [ ] safe confirmation gates

## Phase 4 — Animation Studio

Goal: make animation a first-class engineering workflow.

- [ ] rig detection
- [ ] animation intent parser
- [ ] pose planning
- [ ] keyframe/timeline representation
- [ ] procedural animation generation
- [ ] animation refinement prompts
- [ ] animation-to-gameplay event mapping
- [ ] preview and validation
- [ ] export/sync workflow

Important: generated animation must be represented as an editable, inspectable artifact. LUA-X should not hide animation decisions inside an opaque result.

## Phase 5 — UI + World Studio

- [ ] visual UI editor
- [ ] UI generation from intent
- [ ] responsive layout rules
- [ ] UI style memory
- [ ] scene planning
- [ ] world/asset generation adapters
- [ ] reference-guided style system
- [ ] asset dependency tracking

## Phase 6 — Verification Engine

- [ ] static Luau checks
- [ ] type checks where available
- [ ] unit tests
- [ ] integration tests
- [ ] Studio playtest scenarios
- [ ] regression detection
- [ ] performance checks
- [ ] security checks
- [ ] AI reviewer
- [ ] automatic repair loop

## Phase 7 — Production Workflow

- [ ] Git integration
- [ ] branches and checkpoints
- [ ] reviewable change sets
- [ ] release snapshots
- [ ] environment configuration
- [ ] publish preparation
- [ ] deployment/publish adapters
- [ ] project health dashboard

## Phase 8 — Autonomous Studio

A creator can give LUA-X a high-level objective and receive a plan first. After approval, agents execute, verify, repair, and summarize the work.

Example:

> Build a round-based survival game with a lobby, progression, currency, shop, enemy waves, boss encounters, UI, animations, saving, and analytics.

LUA-X should convert that into a dependency-aware project plan rather than attempting a giant unstructured generation.

## Non-negotiable quality gates

Every feature must:

1. Preserve existing working behavior unless the user explicitly requests a breaking change.
2. Respect Roblox client/server boundaries.
3. Avoid invented APIs or unsupported engine behavior.
4. Produce reviewable changes.
5. Include acceptance criteria.
6. Include verification steps.
7. Explain uncertainty instead of pretending an action succeeded.
8. Never claim an asset, animation, test, or publish succeeded without evidence from the connected toolchain.
