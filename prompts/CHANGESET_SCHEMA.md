# LUA-X Change Set Schema

> The machine-readable contract between the AI engine and the Studio plugin apply layer.
> The plugin's **Generate Plan** expects the API to return exactly this shape under `plan`.

## Top-level shape

```json
{
  "summary": "One-sentence description of the change.",
  "assumptions": ["string"],
  "changes": [
    {
      "operation": "create_script|update_script|create_instance|update_instance|delete_instance|create_animation|create_sound|create_vfx|create_ui|note",
      "target": "Roblox path under game, e.g. game.ServerScriptService.Combat",
      "content": "optional string (see per-operation rules below)",
      "reason": "why this change is needed",
      "risk": "low|medium|high|critical"
    }
  ],
  "acceptanceCriteria": ["observable, testable outcomes"],
  "verification": ["concrete steps the creator/plugin can run"],
  "risks": ["anything uncertain or environment-dependent"]
}
```

Return ONLY valid JSON. No markdown fences. No prose outside the JSON.

## Operations

### create_script
- `target`: parent path + new script name, e.g. `game.ServerScriptService.Combat.SprintHandler`
- `content`: complete Luau source (plain string, no fences)

### update_script
- `target`: path to an existing LuaSourceContainer
- `content`: complete replacement Luau source

### create_instance
- `target`: parent path the instance will be parented under
- `content`: JSON string:
  ```json
  { "className": "Part|Model|Sound|ParticleEmitter|ScreenGui|Frame|TextButton|SurfaceAppearance|…", "name": "optional override", "properties": { "Size": "Vector3.new(4,1,2)", "Color": "Color3.fromRGB(120,140,180)", "Material": "Enum.Material.Slate", "Anchored": true } }
  ```
- Property value rules: numbers, booleans, plain strings, or these resolvable forms:
  - `Vector3.new(x,y,z)`, `UDim2.new(x0,x1,y0,y1)`, `UDim.new(x0,x1)`
  - `Color3.fromRGB(r,g,b)`, `BrickColor.new("name")`
  - `Enum.<Class>.<Name>`
- Never put `Parent` inside `properties` — `parent` is implied by `target`.

### update_instance
- `target`: path to an existing Instance
- `content`: JSON string `{ "properties": { ... } }` (same value rules as create_instance)

### delete_instance
- `target`: path to the Instance to remove
- `content`: omitted

### create_animation
- `target`: parent path (usually `game.Workspace` or a rig's AnimationController location)
- `content`: JSON string with `className` defaulting to `Animation`:
  ```json
  { "properties": { "AnimationId": "rbxassetid://<REAL_ID>" } }
  ```
- **You may only use a real AnimationId you can confirm.** If no real asset exists, instead emit `create_script` that builds the motion with `KeyframeSequence`/`AnimationTrack` programmatically (with a clearly marked `-- ASSET REQUIRED:` only when genuinely needed), or mark the upload as pending in `risks`.

### create_sound
- `target`: parent path (usually `game.SoundService` or the sound owner)
- `content`: JSON string with `className` defaulting to `Sound`:
  ```json
  { "properties": { "SoundId": "rbxassetid://<REAL_ID>", "Looped": false, "Volume": 0.5, "Pitch": 1 } }
  ```
- **You may only use a real SoundId you can confirm.** If no real asset exists, emit sound-design Luau (groups, fades, positional logic) with assets marked pending.

### create_vfx
- `target`: parent path
- `content`: JSON string with `className` defaulting to `ParticleEmitter` (also valid: `Beam`, `SurfaceAppearance`, `Light`, `Smoke`, `Fire`):
  ```json
  { "className": "ParticleEmitter", "name": "Sparks", "properties": { "Rate": 120, "Lifetime": "NumberRange.new(0.5,0.9)", "Speed": "NumberRange.new(4,8)", "Color": "ColorSequence.new(Color3.fromRGB(255,200,80), Color3.fromRGB(255,80,40))", "Size": "NumberSequence.new(1,0.2)", "Enabled": true } }
  ```

### create_ui
- `target`: parent path (usually a `ScreenGui` under `game.Players.<player>.PlayerGui`, or the workspace UI container)
- `content`: JSON string with `className` defaulting to `Frame` (also valid: `ScreenGui`, `TextLabel`, `TextButton`, `ImageLabel`, `ScrollingFrame`, `TextInput`, `UIListLayout`, `UICorner`, `UIPadding`, `UIStroke`):
  ```json
  { "className": "Frame", "name": "InventoryPanel", "properties": { "Size": "UDim2.new(0,420,0,320)", "Position": "UDim2.new(0.5,-210,0.5,-160)", "AnchorPoint": "Vector2.new(0.5,0.5)", "BackgroundColor3": "Color3.fromRGB(18,22,30)", "BackgroundTransparency": 0 } }
  ```

### note
- informational only. The plugin never applies notes.

## Validation rules (mirrored by the API and the plugin)

- `summary` is a non-empty string
- `assumptions`, `acceptanceCriteria`, `verification`, `risks` are string arrays
- `changes` is an array; every item has `operation`, `target`, `reason`, `risk`
- `operation` must be in the supported set
- `risk` must be `low|medium|high|critical`
- `content` is optional but required for script/instance create/update operations

## Ambiguity

If the creator's request is genuinely underspecified (e.g. no rig, no sound assets, no place for UI), state the ambiguity in `assumptions` and choose the most reasonable default, then note it in `risks`. Prefer a concrete, reviewable plan over an endless question list. Ask at most a few targeted questions when the answer materially changes the implementation.