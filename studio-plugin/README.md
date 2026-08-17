# LUA-X Roblox Studio Plugin

This directory contains the installable LUA-X Studio bridge plugin.

## Install

1. Open Roblox Studio's local **Plugins** folder from Studio's plugin-management UI.
2. Copy `LUA-X.plugin.lua` into that folder.
3. Restart Roblox Studio.
4. Open the **Plugins** tab and launch **LUA-X**.

The plugin is intentionally a normal local Studio plugin script so you can inspect the source before installing it.

## First run

The plugin defaults to:

`https://lua-x-api.vercel.app/api/ai/generate`

The backend endpoint can be changed in the plugin UI and is stored using the plugin's own settings.

No NVIDIA or provider API key is stored in the plugin. The plugin only sends the creator prompt, selected Studio context, and the place ID to the LUA-X API.

## Current capabilities

- Open a dockable LUA-X Studio window.
- Read the current Studio selection and selected Luau source.
- Send structured project context to the LUA-X backend.
- Receive and preview a validated LUA-X `AIPlan`.
- Apply `update_script` proposals through `ScriptEditorService`.
- Create `Script` instances for `create_script` proposals.
- Leave instance mutations and other unsupported proposal types as deferred review items.
- Add `ChangeHistoryService` waypoints around applied changes for Studio undo/history.
- Never automatically execute arbitrary AI code.

## Architecture

The plugin is the Studio-side adapter. The backend remains responsible for AI provider access and orchestration. This matches the repository's Roblox Bridge and change-set architecture instead of putting model credentials or provider logic into Studio.

## Troubleshooting

If generation fails, verify that the endpoint is reachable from Studio and that the deployed LUA-X API has an NVIDIA provider configured. The plugin surfaces the backend HTTP status/body in its status area.

If a generated plan contains `create_instance`, `update_instance`, `delete_instance`, or `note`, those entries remain visible but are not automatically applied by this first installable plugin. That keeps the Studio mutation surface bounded while the full change-set/verification bridge is integrated.
