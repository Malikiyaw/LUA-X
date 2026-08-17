# LUA-X Roblox Studio Plugin

This directory contains the installable LUA-X Studio bridge plugin.

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

`https://lua-x-api.vercel.app/api/ai/generate`

The backend endpoint can be changed and saved in the plugin UI (stored with the plugin's own settings). **Test Connection** checks the backend's health endpoint and reports the result in the status bar.

No NVIDIA or provider API key is stored in the plugin. The plugin only sends the creator prompt, selected Studio context, and the place ID to the LUA-X API.

## Current capabilities

- Toolbar button created first, so the plugin is visible as soon as Studio successfully loads the local plugin script.
- Dock opens on demand when you click the LUA-X toolbar button.
- Reads the current Studio selection and selected Luau source.
- Sends structured project context to the LUA-X backend.
- Receives and previews a validated LUA-X `AIPlan`.
- Applies `update_script` proposals through `ScriptEditorService` with a direct `Source` fallback.
- Creates `Script` instances for `create_script` proposals.
- Two-click confirmation before applying changes.
- Uses `ChangeHistoryService` waypoints so Studio Undo can revert applied changes.
- Leaves unsupported instance mutations and notes as deferred review items.
- Never automatically executes arbitrary AI code.

## Troubleshooting

- **Plugin is not visible:** first verify the file is inside the exact folder opened by **Plugins → Manage Plugins → Open Plugins Folder**. Then fully restart Studio. If needed, run `install-plugin.ps1 -PluginsDir "<that exact folder>"`.
- **Filename problem:** make sure the installed file is `LUA-X.lua`, not `LUA-X.lua.txt`. Enable Windows Explorer's **File name extensions** option when checking.
- **Plugin loads but no button appears:** open Studio's Output window and PluginDebugService/debugger to check for a plugin runtime error. The plugin's first statements create the toolbar, so a startup error should be visible there.
- **Connection fails:** enable **Game Settings → Security → Allow HTTP Requests**, then use **Test Connection**.
- **No plan / API error:** confirm the deployed LUA-X API is healthy and has an NVIDIA provider configured.

## Architecture

The plugin is the Studio-side adapter. The backend remains responsible for AI provider access and orchestration. This keeps model credentials out of Studio and keeps the Studio mutation surface bounded and reviewable.
