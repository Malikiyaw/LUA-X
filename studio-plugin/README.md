# LUA-X Roblox Studio Plugin

This directory contains the **one and only** production plugin source:

`studio-plugin/LUA-X-connected.lua`

The website/download pipeline (`scripts/sync-plugin.mjs`) generates `LUA-X.lua`
plus `plugin-manifest.json` (with SHA-256) from this single source. There is no
second plugin implementation.

```
LUA-X-connected.lua  →  sync-plugin.mjs  →  LUA-X.lua  →  website download
```

## What it does

- **Live connection:** heartbeats the LUA-X backend every 5 seconds so the
  website shows your Studio session as **Online**. The session ID is persistent
  (stored in plugin settings) and survives Studio restarts.
- **Commands from the website:** polls the backend command queue and answers
  `ping`, `refresh_context`, `analyze`, `verify`, `stop`, and `build` requests.
- **Context:** reads the current Studio selection, selected scripts and their
  source, and reports it to the backend with every heartbeat.
- **Plan → review → confirm → apply → verify:** generates a structured change
  plan from the LUA-X API, shows it for review, applies script updates through
  `ScriptEditorService` with a `Source` fallback, records `ChangeHistoryService`
  waypoints (Studio Undo works), and verifies the result.
- **No silent failures:** widget creation falls back from the async API to the
  legacy API, and any startup error is shown in a visible error widget and
  printed to the Studio Output window.
- **Connection card:** the dock shows live Status / Project / Place ID /
  Session / Website rows plus a **Disconnect** / **Reconnect** button.
- **Startup diagnostics:** **Run Diagnostics** tests API health, AI readiness,
  HTTP Requests permission, and session registration, and prints the last error
  visibly in the dock.

## Install

### Windows (recommended)

Run the one-click installer from the repository root:

```powershell
.\install-plugin.ps1
```

The installer writes `LUA-X.lua` into the current Windows Roblox Studio local
Plugins directory, which is commonly under `%LOCALAPPDATA%\Roblox\Plugins`.

For maximum reliability, open **Roblox Studio → Plugins → Manage Plugins →
Open Plugins Folder** and pass that exact directory:

```powershell
.\install-plugin.ps1 -PluginsDir "C:\path\opened\by\Studio"
```

### Manual

1. Open Roblox Studio.
2. **Plugins → Manage Plugins → Open Plugins Folder** (use the exact folder Studio opens).
3. Copy `LUA-X.lua` from the website download (or the repo via `sync-plugin.mjs`) into that folder.
4. Close Roblox Studio completely and reopen it.
5. Open the **Plugins** tab and click the **LUA-X** toolbar button.

## First run

The plugin defaults to `https://lua-x-api.vercel.app/api/ai/generate` and keeps
heartbeating immediately — the website should show **Studio Online** within a
few seconds. The endpoint can be changed and saved in the plugin UI.

No NVIDIA or provider API key is stored in the plugin. Keys live only in the
Vercel/server environment (`NVIDIA_API_KEY`, `NVIDIA_API_KEY_1..4`).

## Troubleshooting

- **Not visible:** verify the file is inside the exact folder opened by
  **Plugins → Manage Plugins → Open Plugins Folder**, then fully restart Studio.
- **Click does nothing:** check Studio's Output window — the plugin now reports
  startup errors both in Output and in a visible error widget.
- **Connection fails:** enable **Game Settings → Security → Allow HTTP Requests**,
  then use **Run Diagnostics** in the plugin and check the Website/AI chips and
  the connection card.
- **Website flips offline:** heartbeats stop when Studio closes; the 20s
  presence TTL then expires. For cross-instance reliability set
  `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` on Vercel — the backend
  auto-detects them (free Vercel KV tier).

## Architecture

The plugin is the Studio-side adapter. The backend (`apps/api/src/studio-handler.ts`,
shared by the Vercel functions and the local API server) owns the session
registry and command queue; the website polls status and can queue commands.
AI orchestration happens on the backend through the NVIDIA key pool.