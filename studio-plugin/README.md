# LUA-X Roblox Studio Plugin

This directory contains the installable LUA-X Studio bridge plugin.

## What it does

The plugin links your Roblox Studio session to the LUA-X website:

- **Connect** registers the session with the LUA-X backend and keeps it alive with heartbeats, so the website shows **Studio connected**.
- **Ping** lets the website reach into Studio; when you press *Ping Studio* on the website, the plugin flashes and logs *Ping received*.
- **Disconnect** removes the session instantly, and the website flips back to **Studio offline**.

The actual LUA-X chat lives on the website — open `https://lua-x-api.vercel.app` to talk to LUA-X. The plugin intentionally has no chat UI.

## Install

### Windows (recommended)

Run the one-click installer from the repository root:

```powershell
.\install-plugin.ps1
```

The installer writes `LUA-X.lua` into the current Windows Roblox Studio local Plugins directory, which is commonly under `%LOCALAPPDATA%\Roblox\Plugins`.

For maximum reliability, you can open **Roblox Studio → Plugins → Manage Plugins → Open Plugins Folder** and pass that exact directory to the installer:

```powershell
.\install-plugin.ps1 -PluginsDir "C:\path\opened\by\Studio"
```

The repository source remains `studio-plugin\LUA-X.plugin.lua`; the installer converts it to the normal `LUA-X.lua` local-plugin filename without a UTF-8 BOM.

### Manual

1. Open Roblox Studio.
2. Go to **Plugins → Manage Plugins → Open Plugins Folder**. Use the exact folder Studio opens; do not guess the location.
3. Copy `LUA-X.lua` into that folder. If you downloaded the source file directly from GitHub instead, `studio-plugin/LUA-X.plugin.lua` can also be copied as a local plugin script, but the packaged website download is intentionally named `LUA-X.lua`.
4. Close Roblox Studio completely and reopen it.
5. Open the **Plugins** tab and look for the **LUA-X** toolbar button.

Roblox exposes the configured local plugin directory as `Studio.PluginsDir`; the exact filesystem path can vary by installation. The Studio documentation also supports saving local plugins directly from the Plugins workflow.

The plugin is intentionally a normal local Studio plugin script so you can inspect the source before installing it.

## First run

The plugin defaults to:

`https://lua-x-api.vercel.app`

The backend endpoint can be changed and saved in the plugin UI (stored with the plugin's own settings). **Test** checks the backend's health endpoint and reports the result in the log.

No NVIDIA or provider API key is stored in the plugin. The plugin only sends the place ID, session ID, place name, and plugin version to the LUA-X API.

## Current capabilities

- Toolbar button created first, so the plugin is visible as soon as Studio successfully loads the local plugin script.
- Dock opens on demand when you click the LUA-X toolbar button.
- Manual **Connect** registers the session; heartbeats every 8s keep it alive while connected.
- Polls the backend for queued commands (every 4s) and answers **ping** with a visual flash and an immediate heartbeat.
- **Disconnect** (or closing Studio) removes the session so the website shows offline immediately.
- Session card shows place name, session ID, and endpoint; live log shows connection and ping events.
- Saves the endpoint in plugin settings; auto-retries after network failures.

## Troubleshooting

- **Plugin is not visible:** first verify the file is inside the exact folder opened by **Plugins → Manage Plugins → Open Plugins Folder**. Then fully restart Studio. If needed, run `install-plugin.ps1 -PluginsDir "<that exact folder>"`.
- **Filename problem:** make sure the installed file is `LUA-X.lua`, not `LUA-X.lua.txt`. Enable Windows Explorer's **File name extensions** option when checking.
- **Plugin loads but no button appears:** open Studio's Output window and PluginDebugService/debugger to check for a plugin runtime error. The plugin's first statements create the toolbar, so a startup error should be visible there.
- **Connection fails:** enable **Game Settings → Security → Allow HTTP Requests**, then use **Test**.
- **Website shows offline while connected:** the session expires if heartbeats stop (e.g. Studio closed, or the backend is unreachable). Reconnect by pressing Connect again. Presence is held in the serverless registry; if it flaps, consider adding Vercel KV env vars (`UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`) — the backend already supports it.

## Architecture

The plugin is the Studio-side presence/command adapter. The backend (`api/studio.ts`) holds the session registry and command queue; the website polls it for status and can queue pings. AI chat stays entirely on the website, so no model credentials ever enter Studio.