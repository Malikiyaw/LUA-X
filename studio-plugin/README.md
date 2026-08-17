# LUA-X Roblox Studio Plugin

This directory contains the installable LUA-X Studio bridge plugin.

## Install

### Windows (recommended)

Run the one-click installer from the repository root:

```powershell
.\install-plugin.ps1
```

It finds your real Documents folder (OneDrive-safe), creates the correct
`Roblox\Plugins` folder, and installs `LUA-X.plugin.lua` with the right name
and encoding.

### Manual

1. Open Roblox Studio and go to **Plugins** → **Manage Plugins** → **Open Plugins Folder**.
   This opens `%USERPROFILE%\Documents\Roblox\Plugins` — this exact folder is
   required; a differently named or located folder is ignored by Studio.
2. Copy `LUA-X.plugin.lua` into that folder. The `.plugin.lua` suffix is
   mandatory — Studio does not load plain `.lua` files as plugins.
3. Restart Roblox Studio.
4. Open the **Plugins** tab and launch **LUA-X**.

The plugin is intentionally a normal local Studio plugin script so you can
inspect the source before installing it.

## First run

The plugin defaults to:

`https://lua-x-api.vercel.app/api/ai/generate`

The backend endpoint can be changed and saved in the plugin UI (stored with the
plugin's own settings). **Test Connection** checks the backend's health
endpoint and reports the result in the status bar.

No NVIDIA or provider API key is stored in the plugin. The plugin only sends
the creator prompt, selected Studio context, and the place ID to the LUA-X API.

## Current capabilities

- Toolbar button created first, so the plugin is always visible in **Plugins**
  even if backend or widget initialization fails.
- Dock opens on demand when you click the LUA-X toolbar button (nothing runs
  on startup; nothing network-related runs until you click).
- Read the current Studio selection and selected Luau source.
- Send structured project context to the LUA-X backend.
- Receive and preview a validated LUA-X `AIPlan`.
- Apply `update_script` proposals through `ScriptEditorService`
  (with a direct `Source` write fallback).
- Create `Script` instances for `create_script` proposals.
- Two-click confirm before applying; `ChangeHistoryService` waypoints around
  applied changes for Studio undo/history.
- Leave instance mutations and other unsupported proposal types as deferred
  review items.
- **Run Local Verification** reports plugin-side state only (selection,
  context count, plan size, endpoint) — it never claims a runtime playtest
  passed.
- Never automatically executes arbitrary AI code.

## Architecture

The plugin is the Studio-side adapter. The backend remains responsible for AI
provider access and orchestration. This matches the repository's Roblox Bridge
and change-set architecture instead of putting model credentials or provider
logic into Studio.

## Troubleshooting

- **Plugin not visible:** the file must be `%USERPROFILE%\Documents\Roblox\Plugins\LUA-X.plugin.lua`
  exactly, and Studio must be restarted after installing. Verify the path with
  `install-plugin.ps1` (run it again) or check via Plugins → Manage Plugins.
- **Connection fails:** enable Game Settings → Security → Allow HTTP Requests,
  then use **Test Connection**. The plugin surfaces the backend HTTP
  status/body in its status area.
- **No plan / API error:** confirm the deployed LUA-X API is healthy and has
  an NVIDIA provider configured (the endpoint's `/api/health` should return
  `status: ok`, and `/api/ai/generate` should not return 503).
- If a generated plan contains `create_instance`, `update_instance`,
  `delete_instance`, or `note`, those entries remain visible but are not
  automatically applied. That keeps the Studio mutation surface bounded while
  the full change-set/verification bridge is integrated.