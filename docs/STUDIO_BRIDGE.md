# LUA-X Roblox Studio Bridge — Phase 3

## Why this exists

LUA-X does not pretend a browser can directly mutate an open Roblox Studio session. The bridge is an explicit adapter between the LUA-X orchestration layer and Roblox Studio's built-in MCP server.

Roblox Studio's current MCP server runs locally and communicates with an MCP client over stdio. Roblox documents tools for game-tree exploration, script reading/editing/search, Luau execution, playtesting, console output, screen capture, player input, asset operations, and multiple Studio sessions. citeturn0search0

## Boundary

```text
LUA-X Web / Orchestrator
          │
          │ typed bridge contract
          ▼
   Roblox MCP Adapter
          │
          │ MCP client transport
          ▼
 Roblox Studio MCP Server
          │
          ▼
    Open Studio Session
```

The bridge package deliberately does **not** implement the local Studio process itself. That belongs to the platform/client integration layer because Roblox owns the local MCP server lifecycle and transport details.

## Read vs write

Read operations are allowed to build project context:

- `get_studio_state`
- `list_roblox_studios`
- `search_game_tree`
- `inspect_instance`
- `script_read`
- `script_search`
- `script_grep`
- `get_console_output`
- `screen_capture`

Mutating operations require an explicit confirmation when the bridge is configured with `requireConfirmation: true`:

- `multi_edit`
- `execute_luau`
- `insert_asset`
- `upload_image`
- `start_stop_play`
- player input/navigation
- `set_active_studio`

This separation is intentional. Roblox states that connected MCP clients can read and modify content in open places and recommends connecting only clients you trust. citeturn0search0

## Safe execution model

```text
AI proposes action
       ↓
Change Set / Risk Check
       ↓
User confirmation when required
       ↓
Bridge validation
       ↓
MCP tool call
       ↓
Evidence returned
       ↓
Verification
```

The bridge must never report a successful mutation merely because an action was requested. The underlying MCP result must confirm success.

## Phase 3 implementation status

### Complete

- Typed MCP request/result contracts
- Tool allowlist
- Read/write classification
- Confirmation gate for mutations
- Studio state access
- Data Model inspection adapter
- Script read/search/grep adapters
- Script edit adapter
- Luau execution adapter
- Play start/stop adapter
- Console-output adapter
- Screen-capture adapter contract
- Unit tests for safety and request construction

### Deliberately pending

- Actual stdio MCP transport process
- Desktop installer/launcher
- Studio pairing UI
- Authentication/session persistence
- Full Data Model → Phase 1 incremental index synchronization
- End-to-end playtest evidence from a real Studio instance

These require a real desktop Roblox Studio environment. Roblox Studio is currently supported on Windows and Mac, not iOS/mobile. citeturn0search11

## Security notes

Never put arbitrary secrets into source code or generated Roblox scripts. Roblox provides a Secrets system for sensitive credentials and warns about security implications around HTTP/API access. citeturn0search4

The bridge must also preserve Roblox's client/server security model. Roblox explicitly recommends server validation of client-originated data, particularly around RemoteEvents and RemoteFunctions. citeturn0search10

## Next integration milestone

Build the desktop connector that starts/attaches to Roblox Studio's documented MCP server, exposes the typed bridge to the LUA-X web application, and continuously synchronizes project observations into the Phase 1 index.
