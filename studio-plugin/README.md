# LUA-X Roblox Studio Plugin

This directory contains the installable LUA-X Studio bridge plugin.

## Install correctly

Roblox local plugins are loaded from Studio's configured **Plugins Dir**. The safest way to find the exact directory is **Plugins → Plugins Folder** inside Roblox Studio, or check Studio's plugin-directory setting. Roblox documentation exposes this as Studio's local plugins directory, and community guidance consistently uses the configured Plugins Dir rather than an arbitrary folder. citeturn180901search1turn180901search3

1. In Roblox Studio, open **Plugins → Plugins Folder**.
2. Download the plugin from the LUA-X website. The website now downloads it as **`LUA-X.lua`**.
3. Put **`LUA-X.lua`** directly inside that exact Plugins Dir — not inside another folder.
4. Fully close and reopen Roblox Studio.
5. Open the **Plugins** tab. The local plugin creates a **LUA-X** toolbar button; local plugins are executed from the local Plugins directory rather than being installed through the normal marketplace/plugin manager UI. citeturn180901search2turn180901search9

### Important filename check

Make sure Windows has not saved the file as `LUA-X.lua.txt`. In File Explorer, enable **View → Show → File name extensions** and confirm the filename ends exactly in **`.lua`**.

### If LUA-X still does not appear

Use **Plugins → Plugins Folder** again and confirm the file is in the directory Studio actually opened. Studio can be configured to use a different Plugins Dir, so `%localappdata%\Roblox\Plugins` is only the default on Windows, not a guaranteed path for every installation. citeturn180901search3

If Studio reports a local-plugin load error, open **View → Output** after restarting; that will show whether the file was found but failed while loading.

## First run

The plugin defaults to:

`https://lua-x-api.vercel.app/api/ai/generate`

You can also enter the Vercel base URL (for example `https://lua-x-api.vercel.app`) and the plugin will normalize it to `/api/ai/generate` automatically. The selected endpoint is persisted with the plugin settings.

Before generating, use **Test Connection**. Roblox Studio must have **Allow HTTP Requests** enabled for the place. The test checks `GET /api/health` and reports the HTTP status/body in the plugin.

No NVIDIA or provider API key is stored in the plugin. The plugin sends only the creator prompt, place ID, selected instance paths, and bounded source context to the configured LUA-X API.

## Current capabilities

- Open a dockable LUA-X Studio window from the Plugins toolbar.
- Persist and normalize the backend endpoint.
- Test backend connectivity before generation.
- Automatically refresh context when Studio selection changes.
- Collect selected instances plus a bounded set of descendant Luau scripts.
- Send structured project context to the canonical LUA-X AI pipeline.
- Receive and preview a validated LUA-X `AIPlan`.
- Require a second explicit click before mutating Studio.
- Apply `update_script` proposals through `ScriptEditorService` with a `Source` fallback.
- Create `Script` instances for `create_script` proposals.
- Add `ChangeHistoryService` waypoints before and after application for Studio undo/history.
- Show per-change success/failure results.
- Run plugin-side state verification without falsely claiming that runtime playtests passed.
- Leave `create_instance`, `update_instance`, `delete_instance`, and `note` operations deferred and visible rather than executing unsupported mutations.
- Never automatically execute arbitrary AI code.

## Architecture

The plugin is the Studio-side adapter. The backend remains responsible for AI provider access and orchestration. The Studio plugin does not contain model credentials or provider implementation code.

The intended flow is:

`Studio context → AI plan → review → explicit apply → Studio history`

The current installable surface deliberately limits automatic mutation to script creation/update. Full instance mutation and automated runtime verification require the remaining live Studio bridge components.
