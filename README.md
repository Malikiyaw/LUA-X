# LUA-X

> **The AI-native development studio for Roblox creators.**

**Current version: `0.11.0-alpha`**  
**Status: Phases 0–11 core implemented + production-hardening core + installable Studio plugin**  
**Release channel: Alpha / active development**

LUA-X is designed around one idea: a Roblox creator should be able to describe a feature, let a project-aware AI engineering system plan it, build it, test it, inspect the result, and iterate without losing control of the project.

> **Important:** LUA-X is currently an engineering alpha. The repository contains the core architecture and domain implementations for the roadmap, but it is **not yet a fully deployed production service**. Live Roblox Studio execution, cloud infrastructure, billing, and end-to-end autonomous operation are not claimed complete until those integrations are actually connected and verified.

## Product thesis

LUA-X is not just a prompt box that returns Luau. It is a project-aware development system with shared project context, specialized agents, verification loops, animation workflows, UI generation, world generation, autonomous orchestration, a unified workspace, and a production-oriented cloud architecture.

### Core loop

`Intent → Understand → Plan → Build → Apply → Verify → Playtest → Repair → Review → Sync`

## Core capabilities

- 🧠 Project-aware AI orchestration architecture
- 🏗️ Game architecture and feature planning
- 💻 Luau generation/refactoring architecture
- 🎬 Animation workflow model
- 🎨 Structured Roblox UI engine
- 🌎 Structured world/scene engine
- 🧪 Verification, evidence, failure classification, and bounded repair
- 🤖 Autonomous build planning with dependency-aware execution
- 🔗 Unified multi-surface Fusion workspace
- ☁️ Cloud project/team/audit/snapshot domain models
- 🛡️ Production-hardening primitives for security, permissions, reliability, and scaling
- 🔀 Change-set, approval, audit, snapshot, and rollback foundations
- 🔌 Studio integration architecture
- 🧩 Prompt/context-engineering system

## Install LUA-X in Roblox Studio

The repository now includes an installable local Studio plugin at [`studio-plugin/LUA-X.plugin.lua`](studio-plugin/LUA-X.plugin.lua).

On Windows, the one-click installer locates the correct folder for you:

```powershell
.\install-plugin.ps1
```

Manual install (Studio only loads local plugins from this exact folder with the `.plugin.lua` suffix):

1. In Studio, open **Plugins** → **Manage Plugins** → **Open Plugins Folder** (opens `%USERPROFILE%\Documents\Roblox\Plugins`).
2. Copy `LUA-X.plugin.lua` into that folder.
3. Restart Roblox Studio.
4. Open the **Plugins** tab and launch **LUA-X**.
5. Select relevant scripts/models and describe the change in the LUA-X dock.
6. Generate the structured plan, review it, then explicitly apply the supported script changes.

Full installation and troubleshooting notes are in [`studio-plugin/README.md`](studio-plugin/README.md).

The plugin does **not** contain NVIDIA/provider API keys. It talks to the LUA-X backend, whose current AI endpoint is `https://lua-x-api.vercel.app/api/ai/generate` by default. Unsupported instance mutations remain deferred instead of being executed blindly.

## Roadmap status

| Phase | System | Status |
|---|---|---|
| 0 | Foundation | **Core complete** |
| 1 | Project Intelligence | **Core implemented** |
| 2 | AI Engineering Brain | **Core implemented** |
| 3 | Studio Bridge | **Core implementation + installable plugin** |
| 4 | Code Builder | **Core implemented** |
| 5 | Animation Studio | **Core implemented** |
| 6 | UI Studio | **Core implemented** |
| 7 | World Studio | **Core implemented** |
| 8 | Verification & Playtest Intelligence | **Core implemented** |
| 9 | Autonomous Game Builder | **Core implemented** |
| 10 | LUA-X Fusion | **Core implemented** |
| 11 | Cloud / Production | **Core implemented** |
| H | Production Hardening | **Core implemented** |

### What “core implemented” means

A phase marked **core implemented** has repository-level domain logic, contracts, validation, tests, and/or prompts for the capability. It does **not** automatically mean that every external integration is production-ready.

## Production hardening

The hardening layer is designed around four priorities:

### 🔐 Security

- Explicit authorization policies
- Project-scoped access control
- Least-privilege operations
- Approval gates for risky mutations
- AI output treated as untrusted input
- Secret-safe audit design

### 🛡️ Reliability

- Bounded retries
- Exponential backoff
- Idempotency-aware operation design
- Dependency health states
- Bounded autonomous repair loops
- Evidence-backed completion

### 👥 Permissions

Supported role model:

`OWNER → ADMIN → DEVELOPER → DESIGNER → REVIEWER → VIEWER`

High-risk operations require appropriate authorization and, where configured, explicit approval.

### ⚡ Scaling

The intended production architecture separates interactive API requests from long-running AI, Studio, verification, and cloud jobs. Stateless application nodes can dispatch durable jobs to specialized workers while persistent storage maintains project state, history, audit records, and usage data.

## Competitive direction

LUA-X is intentionally broader than a Roblox-only AI code generator. Its product direction combines project intelligence, code, animation, UI, world building, verification, autonomous orchestration, and controlled Studio operations into one development lifecycle.

The goal is not to win by producing the longest prompt. The goal is to produce **better context, safer changes, stronger verification, and more useful iteration**.

## Prompt engine philosophy

The quality of LUA-X should come from **context engineering**, not simply a longer user prompt.

Every request should be transformed into a structured execution brief containing:

1. Creator intent
2. Existing project context
3. Relevant Roblox services and APIs
4. Current architecture
5. Constraints and design rules
6. Acceptance criteria
7. Required file / instance changes
8. Security requirements
9. Performance requirements
10. Test cases
11. Verification requirements
12. Rollback strategy

See [`docs/PROMPT_ENGINE.md`](docs/PROMPT_ENGINE.md) and [`prompts/MASTER_SYSTEM.md`](prompts/MASTER_SYSTEM.md).

## Repository architecture

```text
LUA-X
├── apps/
│   ├── api/
│   └── web/
├── packages/
│   ├── verification-engine/
│   ├── autonomous-engine/
│   ├── fusion-core/
│   ├── cloud-core/
│   └── hardening-core/
├── studio-plugin/
│   ├── LUA-X.plugin.lua
│   └── README.md
├── prompts/
│   ├── MASTER_SYSTEM.md
│   ├── LUau.md
│   ├── ANIMATION.md
│   ├── UI.md
│   ├── WORLD.md
│   ├── VERIFICATION.md
│   └── AUTONOMOUS.md
└── docs/
    ├── ARCHITECTURE.md
    ├── PHASE_6.md
    ├── PHASE_8.md
    ├── PHASE_9.md
    ├── PHASE_10_11.md
    └── PRODUCTION_HARDENING.md
```

## Versioning

LUA-X uses a **pre-1.0 development version** because complete external product integrations are not yet production-complete.

- **`0.11.0-alpha`** — roadmap core through Phase 11
- **`0.11.x`** — stabilization, integration, testing, and hardening iterations
- **`0.12.x`** — live integration milestones as they are actually verified
- **`1.0.0`** — reserved for a genuinely production-ready end-to-end release

Version numbers are not claims that every Phase 0–11 external dependency is already deployed.

## Roadmap

See [`ROADMAP.md`](ROADMAP.md).

## Prompt library

- [`prompts/MASTER_SYSTEM.md`](prompts/MASTER_SYSTEM.md)
- [`prompts/LUAU.md`](prompts/LUAU.md)
- [`prompts/ANIMATION.md`](prompts/ANIMATION.md)
- [`prompts/UI.md`](prompts/UI.md)
- [`prompts/WORLD.md`](prompts/WORLD.md)
- [`prompts/VERIFICATION.md`](prompts/VERIFICATION.md)
- [`prompts/AUTONOMOUS.md`](prompts/AUTONOMOUS.md)

## Guiding principle

**LUA-X should never optimize for impressive-looking generation at the expense of a working Roblox project.**

A generation is only considered successful when it satisfies its acceptance criteria, passes appropriate verification, and has evidence supporting the result.
