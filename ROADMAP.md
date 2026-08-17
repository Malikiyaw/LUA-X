# LUA-X Roadmap

## Phase 0 — Foundation — CORE COMPLETE

- [x] TypeScript + Node.js monorepo
- [x] CI and type/lint/test/build gates
- [x] Runnable local development environment
- [x] Shared domain contracts
- [x] Initial orchestration compiler
- [x] Web health endpoint
- [x] Browser workspace shell
- [x] Automated foundation tests

## Phase 1 — Project Intelligence — CORE IMPLEMENTED

- [x] Typed Roblox project-instance model
- [x] Data Model / hierarchy index contracts
- [x] Script inventory and server/client/shared classification
- [x] Remote map contracts
- [x] Asset reference contracts
- [x] Dependency graph
- [x] Service usage map
- [x] Architecture summary
- [x] Safe query/retrieval primitives
- [x] Project statistics
- [x] Unit tests
- [ ] Live Studio index synchronization
- [ ] Persistent index cache
- [ ] Incremental index updates
- [ ] Semantic/code retrieval

## Phase 2 — AI Engineering Brain — CORE IMPLEMENTED + INTEGRATED

- [x] Master orchestration rules
- [x] Context-aware prompt compiler
- [x] Project-memory interface
- [x] Task decomposition
- [x] Dependency-aware planning
- [x] Specialist routing
- [x] Change-set generation
- [x] Risk assessment
- [x] Acceptance criteria propagation
- [x] Verification propagation
- [x] Deterministic change identifiers
- [x] Shared API generation core
- [x] Multi-key NVIDIA provider adapter
- [x] Automated tests
- [ ] Live project-context retrieval beyond selected Studio context

## Phase 3 — Roblox Studio Bridge — CORE ARCHITECTURE

- [x] Studio MCP integration boundary
- [x] Tool allowlist concept
- [x] Safe mutation/confirmation concept
- [x] Installable Roblox Studio plugin
- [x] Static plugin distribution from the web app
- [ ] Real stdio MCP client
- [ ] Studio pairing/session manager
- [ ] Live Data Model read/write adapter
- [ ] Live Luau execution adapter
- [ ] Live playtest adapter
- [ ] Console/output evidence adapter
- [ ] End-to-end Studio connection tests

## Phase 4 — AI Code Builder & Safe Execution — CORE IMPLEMENTED + INTEGRATED

- [x] Provider-neutral code model interface
- [x] Project-context code prompt builder
- [x] Strict model-output validation
- [x] Structured Luau change operations
- [x] Deterministic change sets
- [x] Risk-based approval policy
- [x] Delete protection
- [x] Stale-write protection
- [x] Dry-run execution adapter
- [x] API pipeline generates execution change sets
- [x] Automated execution safety tests
- [ ] Real Studio mutation adapter
- [ ] End-to-end apply → verify evidence loop

## Phase 5 — Animation Studio — CORE IMPLEMENTED

- [x] Rig and animation domain contracts
- [x] Animation intent model
- [x] Pose/keyframe/timeline representation
- [x] Marker representation
- [x] Animation validation
- [x] Runtime integration check through the API pipeline
- [ ] Studio timeline/editor surface
- [ ] Procedural animation generation
- [ ] Animation refinement prompts
- [ ] Animation-to-gameplay event sync
- [ ] Export/sync workflow

## Phase 6 — UI + World Studio — CORE IMPLEMENTED

- [x] Structured UI domain model
- [x] UI validation
- [x] World/scene domain model
- [x] World validation and statistics
- [x] Runtime integration checks through the API pipeline
- [ ] Visual UI editor
- [ ] UI generation from intent
- [ ] Responsive layout editor
- [ ] World/asset generation adapters
- [ ] Reference-guided style system
- [ ] Asset dependency tracking

## Phase 7 — Verification & Playtest Intelligence — CORE IMPLEMENTED

- [x] Verification run model
- [x] Acceptance criteria model
- [x] Test case/result/evidence model
- [x] Failure classification
- [x] Bounded repair planning
- [x] API pipeline creates verification plans from AI output
- [ ] Static Luau checks wired to a real toolchain
- [ ] Studio playtest scenarios
- [ ] Runtime evidence collection
- [ ] Performance checks
- [ ] Security checks
- [ ] Automatic repair execution loop

## Phase 8 — Production Workflow — CORE ARCHITECTURE

- [x] Change-set foundations
- [x] Review/approval concepts
- [x] Snapshot domain model
- [x] Cloud audit primitives
- [ ] Git integration
- [ ] Branches and checkpoints
- [ ] Persistent snapshots
- [ ] Publish preparation
- [ ] Publish adapters
- [ ] Project health dashboard backed by real project data

## Phase 9 — Autonomous Game Builder — CORE IMPLEMENTED

- [x] Goal model
- [x] Dependency-aware work plan
- [x] Approval state
- [x] Execution state machine
- [x] Bounded repair attempts
- [x] Evidence-backed completion model
- [x] API pipeline creates autonomous build sessions from the orchestration plan
- [ ] Live autonomous Studio execution
- [ ] Automated repair against real verification evidence

## Phase 10 — LUA-X Fusion — CORE IMPLEMENTED

- [x] Unified workspace model
- [x] Surface routing
- [x] Task/session state model
- [x] API pipeline routes requests into workspace surfaces
- [ ] Persistent multi-surface session storage
- [ ] Live Studio session synchronization

## Phase 11 — Cloud / Production — CORE IMPLEMENTED

- [x] Project/team/audit domain model
- [x] Role model
- [x] Snapshot and usage domain primitives
- [x] Production-hardening policy primitives
- [x] Shared multi-key provider architecture
- [ ] Persistent database/storage
- [ ] Authentication and team identity
- [ ] Billing/usage enforcement
- [ ] Durable background jobs
- [ ] Production observability
- [ ] Full horizontal scaling architecture

## Cross-cutting production hardening — CORE IMPLEMENTED

- [x] Authorization policy model
- [x] Least-privilege operation model
- [x] Retry/backoff policy
- [x] Health/dependency model
- [x] Audit record model
- [x] Risk/approval concepts
- [x] Evidence-first completion model
- [x] Shared API/provider integration path
- [ ] Authentication-backed enforcement on every mutating route
- [ ] Persistent audit storage
- [ ] Distributed rate limiting

## Current integration spine

The live application path is now:

`Creator request → Orchestrator → Context-aware prompt → NVIDIA multi-key provider → AI plan validation → Execution change set → Verification plan → Autonomous build session → Fusion workspace routing → domain capability checks → cloud/audit context → hardening health → Roblox Studio bridge status`

The current Studio bridge is intentionally reported as disconnected until a real trusted Studio transport is attached. No Studio mutation is claimed to have occurred merely because the pipeline was generated.

## Non-negotiable quality gates

Every feature must:

1. Preserve existing working behavior unless a breaking change is explicitly requested.
2. Respect Roblox client/server boundaries.
3. Avoid invented APIs or unsupported engine behavior.
4. Produce reviewable changes.
5. Include acceptance criteria.
6. Include verification steps.
7. Explain uncertainty instead of pretending an action succeeded.
8. Never claim an asset, animation, test, playtest, or publish succeeded without evidence from the connected toolchain.
9. Treat model output as untrusted until schema validation passes.
10. Never overwrite changed creator work without detecting the conflict.
