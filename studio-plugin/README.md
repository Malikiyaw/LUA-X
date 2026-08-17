# LUA-X Roblox Studio Plugin

This directory contains the installable LUA-X Studio bridge plugin.

## Install

1. Open Roblox Studio's local **Plugins** folder from Studio's plugin-management UI.
2. Copy `LUA-X.plugin.lua` into that folder.
3. Restart Roblox Studio.
4. Open the **Plugins** tab and launch **LUA-X**.

The plugin is a normal local Studio plugin script so you can inspect the source before installing it.

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

## Troubleshooting

If **Test Connection** fails, enable Studio HTTP Requests and verify that the endpoint is reachable. If the backend returns `503`, the deployed API is reachable but its NVIDIA provider is not configured.

If generation returns an API error, the plugin displays the backend HTTP status and response body. If the response is valid but contains no `plan.changes`, generation is rejected without touching the place.

If a generated plan contains `create_instance`, `update_instance`, `delete_instance`, or `note`, those entries remain review/deferred items and are not automatically applied. This is intentional: the plugin should not mutate arbitrary Studio instances until the corresponding verified bridge operations are implemented.
