# LUA-X Native Roblox Studio MCP Agent

LUA-X now uses Roblox Studio's built-in MCP server as the Studio execution boundary.

## Architecture

```text
Web Chat / AI
    ↓
LUA-X Agent Runtime
    ├── project context
    ├── planning
    ├── permissions
    ├── tool routing
    ├── memory/session state
    └── verification
    ↓
LUA-X Local Agent
    ↓ stdio
Roblox Studio Native MCP
    ↓
Actual Roblox place
```

Roblox documents the Studio MCP server as a local process that communicates with MCP clients over stdio. Studio must be enabled as an MCP server from Assistant → … → Manage MCP Servers. The server exposes tools for script reading/search, editing, Data Model inspection, Luau execution, playtesting, asset generation, Studio targeting, and more.

## Local agent

Build and run from the repository root:

```bash
npm run agent
```

To verify only the MCP handshake and discovered tools:

```bash
npm run check:mcp
```

The local agent uses these native Studio commands:

- Windows: `cmd.exe /c %LOCALAPPDATA%\\Roblox\\mcp.bat`
- macOS: `/Applications/RobloxStudio.app/Contents/MacOS/StudioMCP`

## First connection

1. Open Roblox Studio and load the place you want to control.
2. Open **Assistant → … → Manage MCP Servers**.
3. Enable **Studio as MCP server**.
4. Start the LUA-X local agent.
5. Open the LUA-X web workspace and press **Connect Studio**.
6. LUA-X pairs the web session with the local agent, discovers the available Studio instance, and begins heartbeats.

## Execution model

The web app can generate a structured build plan. Applying a plan queues it for the local agent. The agent validates the plan, executes supported operations through native MCP, reads Studio state/console output, and reports evidence back to the cloud session.

Mutating operations are gated in the bridge and the local agent only executes an explicitly queued plan. Unrecognized plan operations are rejected instead of being silently translated into arbitrary Studio behavior.

## Current execution support

Supported structured operations are mapped as follows:

- `create_script` / `update_script` → native `multi_edit`
- `delete_instance` → native `execute_luau` in Edit mode
- `create_instance`, `update_instance`, `create_ui`, `create_vfx`, `create_sound`, `create_animation` → native `execute_luau` in Edit mode when plan content contains executable Luau
- `create_mesh` → native `generate_mesh`
- `create_material` → native `generate_material`
- `create_procedural_model` → native `generate_procedural_model`
- `note` → recorded without a Studio mutation

The exact native MCP tool schema is discovered at runtime with `tools/list`; LUA-X does not assume a private Roblox server implementation beyond the documented stdio MCP contract.

## Production boundary

The cloud API remains responsible for AI requests, sessions, plans, audit/context state, and web UX. The local agent is responsible for local process access and Studio execution. This prevents the cloud service from attempting to reach a creator's localhost process directly.
