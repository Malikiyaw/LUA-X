# LUA-X Roadmap

## Phase 0 — Foundation — COMPLETE

- [x] Establish product thesis
- [x] Define project-aware prompt architecture
- [x] Define agent roles
- [x] Define verification-first workflow
- [x] Select initial implementation stack: TypeScript + Node.js monorepo
- [x] Create monorepo structure
- [x] Add CI and type/lint/test/build gates
- [x] Build runnable local development environment
- [x] Add shared domain contracts
- [x] Add initial orchestration compiler
- [x] Add web health endpoint and planning API
- [x] Add browser workspace shell
- [x] Add automated Phase 0 tests

## Phase 1 — Project Intelligence — CORE COMPLETE

Goal: LUA-X can understand a Roblox project before changing it.

- [x] Typed Roblox project-instance model
- [x] Data Model / hierarchy index contracts
- [x] Script inventory and server/client/shared classification
- [x] RemoteEvent / RemoteFunction map contracts
- [x] Asset reference contracts
- [x] Dependency graph
- [x] Service usage map
- [x] Project conventions/index warnings foundation
- [x] Architecture summary
- [x] Safe query/retrieval primitives
- [x] Project statistics
- [x] Unit tests for indexing and retrieval primitives
- [x] Studio MCP integration boundary documented
- [ ] Live Studio MCP transport adapter
- [ ] Persistent index cache
- [ ] Incremental index updates
- [ ] Semantic/code retrieval

## Phase 2 — AI Engineering Core — COMPLETE

Goal: turn natural language into controlled, reviewable engineering plans and model-ready execution prompts.

- [x] Master orchestration rules
- [x] Context-aware prompt compiler
- [x] Project-memory interface and in-memory implementation
- [x] Task decomposition
- [x] Dependency-aware execution plan
- [x] Specialist agent routing
- [x] Change-set generation
- [x] Change risk assessment
- [x] Reviewable change-set metadata
- [x] Acceptance criteria propagation
- [x] Verification requirements propagation
- [x] Deterministic change identifiers
- [x] Orchestration integration API
- [x] Phase 2 automated tests
- [ ] Connect model provider adapter
- [ ] Connect live Phase 1 project retrieval
- [ ] Apply/rollback changes against real Studio state

## Phase 3 — Roblox Studio Bridge

Goal: connect the browser workspace to real Roblox projects.

- [ ] Studio MCP client adapter
- [ ] Authenticated/local project pairing
- [ ] Project sync protocol
- [ ] Data Model read/write operations
- [ ] Luau script operations
- [ ] Luau execution adapter
- [ ] Playtest adapter
- [ ] Console/output adapter
- [ ] Safe confirmation gates

## Phase 4 — Animation Studio

Goal: make animation a first-class engineering workflow.

- [ ] Rig detection
- [ ] Animation intent parser
- [ ] Pose planning
- [ ] Keyframe/timeline representation
- [ ] Procedural animation generation
- [ ] Animation refinement prompts
- [ ] Animation-to-gameplay event mapping
- [ ] Preview and validation
- [ ] Export/sync workflow

## Phase 5 — UI + World Studio

- [ ] Visual UI editor
- [ ] UI generation from intent
- [ ] Responsive layout rules
- [ ] UI style memory
- [ ] Scene planning
- [ ] World/asset generation adapters
- [ ] Reference-guided style system
- [ ] Asset dependency tracking

## Phase 6 — Verification Engine

- [ ] Static Luau checks
- [ ] Type checks where available
- [ ] Unit tests
- [ ] Integration tests
- [ ] Studio playtest scenarios
- [ ] Regression detection
- [ ] Performance checks
- [ ] Security checks
- [ ] AI reviewer
- [ ] Automatic repair loop

## Phase 7 — Production Workflow

- [ ] Git integration
- [ ] Branches and checkpoints
- [ ] Reviewable change sets
- [ ] Release snapshots
- [ ] Environment configuration
- [ ] Publish preparation
- [ ] Publish adapters
- [ ] Project health dashboard

## Phase 8 — Autonomous Studio

A creator can give LUA-X a high-level objective and receive a plan first. After approval, agents execute, verify, repair, and summarize the work.

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
