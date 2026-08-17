# Phase 1 — Project Intelligence

## Status

**Implementation: complete for the offline/indexing core.**

Phase 1 is the foundation that lets LUA-X understand a Roblox project before planning changes. Roblox describes each place as a Data Model hierarchy containing world objects and runtime behavior, including server/client/shared scripts. citeturn0search3turn0search1

## What Phase 1 provides

- Typed project-instance records
- Script inventory
- Server/client/shared container classification
- RemoteEvent/RemoteFunction inventory
- Asset inventory contracts
- Dependency edges
- Service usage inventory
- Project statistics
- Targeted project search
- Architecture summary
- Index warnings

## Why the architecture is split

LUA-X should not send an entire game to a model for every prompt. Phase 1 creates a compact project representation that later retrieval code can use to select only relevant context.

Example:

```text
User: Fix my sword combat cooldown.

Project index
  ↓
find combat scripts
  ↓
find cooldown references
  ↓
find related remotes
  ↓
find relevant animation/state modules
  ↓
retrieve only those artifacts
  ↓
Phase 2 prompt compiler
```

## Roblox Studio integration boundary

Current Roblox Studio includes a built-in MCP server that can explore the Data Model, read/search/edit scripts, execute Luau, inspect instances, run playtests, read console output, and capture Studio state. That means LUA-X should treat Studio MCP as a real adapter rather than inventing a parallel unsupported control protocol. citeturn0search0turn0search4

The Phase 1 package intentionally stays transport-agnostic. A future `roblox-protocol` adapter will translate Studio MCP responses into these index types.

## Required adapter output

The future Studio adapter should be able to populate:

- `ProjectInstance[]`
- `ScriptRecord[]`
- `RemoteRecord[]`
- `AssetRecord[]`
- `DependencyEdge[]`
- service usage

The adapter must distinguish **tool-confirmed facts** from inferred information.

## Important limitation

A static index cannot prove runtime behavior. Runtime truth belongs to Phase 6 verification and the Studio playtest layer. Roblox provides Test, Test Here, Run, Server & Clients, and programmatic testing capabilities for this purpose. citeturn0search2turn0search8
