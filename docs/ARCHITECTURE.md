# LUA-X Architecture

## High-level system

```text
┌──────────────────────────────────────────────────────────────┐
│                         LUA-X WEB APP                        │
│ Dashboard │ AI Chat │ Code │ Animation │ UI │ World │ Tests │
└───────────────────────────────┬──────────────────────────────┘
                                │
                         Project Context API
                                │
┌───────────────────────────────▼──────────────────────────────┐
│                    ORCHESTRATION ENGINE                     │
│ Intent Parser → Context Retrieval → Planner → Agent Router  │
│                         → Execution                         │
└───────────────┬──────────────────┬───────────────────────────┘
                │                  │
        ┌───────▼──────┐   ┌───────▼────────┐
        │ Project      │   │ Specialist      │
        │ Intelligence │   │ Agents          │
        │              │   │ Luau            │
        │ Data Model   │   │ Animation       │
        │ Code Index   │   │ UI              │
        │ Dependencies │   │ World           │
        │ Memory       │   │ Security        │
        └───────┬──────┘   │ Performance     │
                │          │ Testing         │
                │          └───────┬─────────┘
                └──────────────────┤
                                   │
                         ┌─────────▼─────────┐
                         │ Change Set Engine │
                         │ Plan / Patch /    │
                         │ Review / Rollback │
                         └─────────┬─────────┘
                                   │
                         ┌─────────▼─────────┐
                         │ Verification      │
                         │ Static / Runtime  │
                         │ Playtest / Perf   │
                         │ Security          │
                         └─────────┬─────────┘
                                   │
                         ┌─────────▼─────────┐
                         │ Roblox Bridge     │
                         │ Studio Plugin     │
                         │ MCP / Tool Layer  │
                         └───────────────────┘
```

## Core components

### 1. Web workspace

The user-facing studio should expose project files, AI activity, live previews, change sets, tests, and connected Roblox state without forcing the creator to understand the underlying orchestration.

### 2. Orchestrator

Receives a creator request and determines:

- intent
- complexity
- affected systems
- context needed
- specialist agents
- tools required
- verification requirements

### 3. Project Intelligence Layer

Build an index of the current project:

- Data Model hierarchy
- scripts/modules
- symbols and references
- remotes
- services
- asset references
- configuration
- tests
- conventions
- architecture decisions

The index should support targeted retrieval rather than sending the entire project to every model call.

### 4. Agent layer

Agents share one project context and one change-set format. They should not independently mutate the project without orchestration and verification.

### 5. Change Set Engine

All meaningful edits should become reviewable operations. This enables previews, diffs, checkpoints, rollback, and audit history.

### 6. Verification Engine

Verification is a first-class subsystem rather than an afterthought. It should accept acceptance criteria and return evidence.

### 7. Roblox Bridge

The bridge connects LUA-X to the actual Roblox development environment. The first implementation should prioritize safe project inspection, script editing, Data Model operations, and playtesting. More advanced generation workflows can be added through explicit adapters.

## Data flow

```text
User request
→ execution brief
→ context retrieval
→ plan
→ approved actions
→ specialist generation
→ change set
→ apply
→ verify
→ repair if needed
→ final change set + evidence
```

## Design constraints

- Do not couple the UI directly to model providers.
- Do not let individual agents bypass the change-set layer.
- Do not treat model output as trusted execution instructions.
- Keep provider adapters replaceable.
- Keep Roblox-specific logic isolated from generic orchestration where possible.
- Make every mutation observable and reversible.
- Store evidence separately from model-generated claims.

## Suggested implementation boundaries

```text
apps/
  web/                 # browser studio
  studio-plugin/       # Roblox Studio bridge

packages/
  orchestrator/        # planning + agent routing
  prompt-engine/       # context-aware prompt compilation
  project-index/       # project intelligence
  change-set/          # diff/apply/rollback
  verification/        # tests + evidence
  roblox-protocol/     # bridge contracts
  shared/              # shared schemas/types

prompts/
docs/
```

The actual stack should be selected after the first technical spike, based on Roblox Studio integration requirements and the chosen hosting/runtime architecture.
