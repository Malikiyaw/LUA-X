# LUA-X Prompt Engine

## Mission

The prompt engine is the control layer between a creator's natural-language request and the model/toolchain. It should improve output by supplying the right context, constraints, architecture, examples, verification rules, and execution format at the right time.

The goal is **not** to make prompts huge. The goal is to make prompts precise, project-aware, testable, and hard to misinterpret.

## The compiler pipeline

```text
Creator Request
      ↓
Intent Parser
      ↓
Project Context Retrieval
      ↓
Architecture Resolver
      ↓
Constraint Resolver
      ↓
Task Decomposer
      ↓
Specialist Router
      ↓
Execution Brief
      ↓
Model
      ↓
Patch / Artifact Proposal
      ↓
Static Verification
      ↓
Runtime Verification
      ↓
Repair Loop
      ↓
Final Change Set
```

## Execution Brief

Every substantial request should be compiled into this internal shape:

```yaml
objective:
  summary: ""
  user_intent: ""
  priority: ""

project:
  name: ""
  experience_type: ""
  architecture: ""
  relevant_services: []
  relevant_scripts: []
  relevant_instances: []
  existing_patterns: []

constraints:
  must_preserve: []
  must_not_change: []
  performance: []
  security: []
  style: []
  compatibility: []

implementation:
  tasks: []
  dependencies: []
  specialist_agents: []
  files_to_change: []
  instances_to_change: []

acceptance:
  functional: []
  visual: []
  runtime: []
  security: []
  performance: []

verification:
  static_checks: []
  runtime_tests: []
  playtest_scenarios: []
  expected_results: []

output:
  change_summary: ""
  unresolved_risks: []
  evidence: []
```

## Context priority

Use context in this order:

1. Current user instruction
2. Explicit project rules
3. Existing project architecture
4. Relevant source code and Data Model state
5. Relevant Roblox API/tool documentation available to the system
6. Existing tests and acceptance criteria
7. Project design memory
8. General model knowledge

When sources conflict, prefer the highest-priority source and surface the conflict.

## Context selection

Do not dump the entire repository into every request. Retrieve only the context needed for the task.

Examples:

- A shop UI task should retrieve UI hierarchy, style rules, related shop scripts, currency interfaces, and relevant tests.
- A combat task should retrieve combat modules, remotes, state machines, animation references, damage validation, and tests.
- A DataStore task should retrieve persistence modules, schema, serialization helpers, retry policy, and existing tests.

## Prompt assembly rules

### Rule 1 — Understand before editing

Before implementation, determine what the creator is actually asking for and identify affected systems.

### Rule 2 — Prefer the smallest correct change

Do not rewrite unrelated systems. Reuse existing abstractions when they are sound.

### Rule 3 — Match the project

Generated code must follow the project's naming, module, folder, typing, formatting, event, and architecture conventions.

### Rule 4 — Server authority

For multiplayer-sensitive systems, treat the server as authoritative. Never trust client-provided currency, damage, rewards, permissions, inventory, progression, or other security-sensitive state.

### Rule 5 — No invented evidence

The model must distinguish between:

- known project facts
- inferred facts
- proposed changes
- tool-confirmed results

It must never say a test passed, asset exported, animation uploaded, or change deployed unless the connected tool returned evidence.

### Rule 6 — Verify the result

Generation is incomplete until acceptance criteria are checked.

### Rule 7 — Repair surgically

If verification fails, use the failure evidence to identify the smallest root-cause fix. Do not regenerate the entire project unless necessary.

### Rule 8 — Explain meaningful tradeoffs

If two valid approaches differ in performance, complexity, compatibility, or maintainability, state the tradeoff and choose according to project constraints.

## Specialist routing

```text
General feature → Architect → relevant specialist → Reviewer → Tester
Luau bug → Luau Engineer → Debugger → Tester
Animation → Animation Director → Luau Integration → Reviewer → Playtester
UI → UI Designer → Luau Integration → Visual Reviewer → Playtester
World → World Planner → Asset/Scene specialist → Performance Reviewer
Security → Security Auditor → Fix Agent → Regression Tester
Performance → Profiler → Optimization Agent → Regression Tester
```

## Conversation continuity

Follow-up requests must modify the existing plan rather than starting from zero.

Example:

```text
User: Add a stamina system.
LUA-X: creates plan and implementation.

User: Make sprint drain stamina faster.
LUA-X: retrieves the existing stamina implementation,
       changes the relevant configuration/logic,
       preserves unrelated behavior, and reruns tests.
```

## Prompt quality scoring

Before execution, score the compiled brief internally:

- Intent clarity
- Context completeness
- Architecture alignment
- Constraint coverage
- Acceptance-test quality
- Security coverage
- Performance coverage
- Tool availability
- Ambiguity risk

If ambiguity materially changes the implementation, ask a focused clarification question. Otherwise choose a reasonable default and state it.

## Output contract

For implementation tasks, the agent should return structured information internally:

```text
PLAN
CHANGES
TESTS
RESULTS
RISKS
NEXT ACTION
```

The user-facing UI can render this as a polished activity timeline instead of exposing raw internal reasoning.

## Why this matters

A longer prompt does not automatically produce a better Roblox project. LUA-X should outperform basic prompting through **better context retrieval, decomposition, tool use, architecture awareness, verification, and iterative repair**.
