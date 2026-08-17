# LUA-X

> **The AI-native development studio for Roblox creators.**

LUA-X is designed around one idea: a Roblox creator should be able to describe a feature, watch an AI engineering team plan it, build it, test it, inspect the result, and iterate without losing control of the project.

## Product thesis

LUA-X is not just a prompt box that returns Luau. It is a project-aware development system with a shared game model, specialized agents, verification loops, animation workflows, visual editing, and Roblox Studio integration.

### Core loop

`Intent → Understand → Plan → Build → Verify → Playtest → Repair → Review → Export/Sync`

## Planned capabilities

- 🧠 Project-aware AI orchestration
- 🏗️ Game architecture and feature planning
- 💻 Luau generation and refactoring
- 🎬 AI-directed animation and keyframe workflows
- 🎨 Roblox UI generation and visual editing
- 🌎 World / scene generation workflows
- 🧪 Automated verification and playtesting
- 🛡️ Roblox-specific security analysis
- ⚡ Performance analysis and optimization
- 🔀 Git-aware change sets, review, rollback, and history
- 🔌 Roblox Studio plugin / MCP integration
- 📦 Asset and project export workflows
- 🧩 Persistent project memory and design rules

## Competitive direction

Current Roblox creation tools demonstrate the value of AI asset generation, code generation, planning, and direct Studio actions. LUA-X combines those ideas into a single project-aware loop rather than treating code, assets, animation, UI, and testing as disconnected generations.

ForgeGUI currently emphasizes AI-generated game assets and connected visual editing. Lemonade AI is a Roblox Studio plugin focused on turning creator instructions into game-building/code workflows. Roblox Assistant itself now includes planning, actions, and verification-oriented workflows. LUA-X's product goal is to go deeper on the complete engineering lifecycle: architecture, implementation, animation, integration, verification, and iteration. citeturn0search0turn0search13turn0search9

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

## Repository status

This repository is currently the **product blueprint and engineering foundation** for LUA-X. Implementation will be delivered in vertical slices so every major feature is connected to the same orchestration and verification architecture.

## Roadmap

See [`ROADMAP.md`](ROADMAP.md).

## Architecture

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Prompt library

- [`prompts/MASTER_SYSTEM.md`](prompts/MASTER_SYSTEM.md)
- [`prompts/LUAU.md`](prompts/LUAU.md)
- [`prompts/ANIMATION.md`](prompts/ANIMATION.md)
- [`prompts/UI.md`](prompts/UI.md)
- [`prompts/WORLD.md`](prompts/WORLD.md)
- [`prompts/TEST.md`](prompts/TEST.md)
- [`prompts/SECURITY.md`](prompts/SECURITY.md)

## Guiding principle

**LUA-X should never optimize for impressive-looking generation at the expense of a working Roblox project.**

A generation is only considered successful when it satisfies its acceptance criteria and survives verification.
