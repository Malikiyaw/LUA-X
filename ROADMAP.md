# LUA-X Roadmap

## Phase 0 — Foundation — COMPLETE

- [x] TypeScript + Node.js monorepo
- [x] CI and type/lint/test/build gates
- [x] Runnable local development environment
- [x] Shared domain contracts
- [x] Initial orchestration compiler
- [x] Web health endpoint and planning API
- [x] Browser workspace shell
- [x] Automated foundation tests

## Phase 1 — Project Intelligence — CORE COMPLETE

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

## Phase 2 — AI Engineering Core — COMPLETE

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
- [x] Orchestration API
- [x] Automated tests
- [ ] Production model-provider adapter
- [ ] Live project-context retrieval

## Phase 3 — Roblox Studio Bridge — CORE COMPLETE

- [x] Studio MCP integration boundary
- [x] Tool allowlist concept
- [x] Safe mutation/confirmation concept
- [x] Official Studio MCP capability mapping
- [ ] Real stdio MCP client
- [ ] Studio pairing/session manager
- [ ] Live Data Model read/write adapter
- [ ] Live Luau execution adapter
- [ ] Live playtest adapter
- [ ] Console/output evidence adapter
- [ ] End-to-end Studio connection tests

## Phase 4 — AI Code Builder & Safe Execution — CORE COMPLETE

- [x] Provider-neutral code model interface
- [x] Project-context code prompt builder
- [x] Strict model-output validation
- [x] Structured Luau change operations
- [x] Deterministic change sets
- [x] Risk-based approval policy
- [x] Delete protection
- [x] Stale-write protection
- [x] Dry-run execution adapter
- [x] Automated execution safety tests
- [ ] Production model provider
- [ ] Real Studio mutation adapter
- [ ] End-to-end generate → review → apply → verify flow

## Phase 5 — Animation Studio

- [ ] Rig detection
- [ ] Animation intent parser
- [ ] Pose planning
- [ ] Keyframe/timeline representation
- [ ] Procedural animation generation
- [ ] Animation refinement prompts
- [ ] Animation-to-gameplay event mapping
- [ ] Preview and validation
- [ ] Export/sync workflow

## Phase 6 — UI + World Studio

- [ ] Visual UI editor
- [ ] UI generation from intent
- [ ] Responsive layout rules
- [ ] UI style memory
- [ ] Scene planning
- [ ] World/asset generation adapters
- [ ] Reference-guided style system
- [ ] Asset dependency tracking

## Phase 7 — Verification Engine

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

## Phase 8 — Production Workflow

- [ ] Git integration
- [ ] Branches and checkpoints
- [ ] Reviewable change sets
- [ ] Release snapshots
- [ ] Environment configuration
- [ ] Publish preparation
- [ ] Publish adapters
- [ ] Project health dashboard

## Phase 9 — Autonomous Studio

A creator can give LUA-X a high-level objective and receive a plan first. After approval, agents execute, verify, repair, and summarize the work.

## Non-negotiable quality gates

Every feature must:

1. Preserve existing working behavior unless a breaking change is explicitly requested.
2. Respect Roblox client/server boundaries.
3. Avoid invented APIs or unsupported engine behavior.
4. Produce reviewable changes.
5. Include acceptance criteria.
6. Include verification steps.
7. Explain uncertainty instead of pretending an action succeeded.
8. Never claim an asset, animation, test, or publish succeeded without evidence from the connected toolchain.
9. Treat model output as untrusted until schema validation passes.
10. Never overwrite changed creator work without detecting the conflict.
