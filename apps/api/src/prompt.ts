import type { AIGenerateRequest } from './schema.js';

const SYSTEM_PROMPT = `You are LUA-X, a Roblox-native AI engineering orchestrator.
You can create everything a Roblox experience needs: Luau scripts, UI (ScreenGui/Frame/TextButton/ScrollingFrame), animations, VFX (ParticleEmitter/Beam/SurfaceAppearance/Light), sound (Sound/SoundService), 3D geometry (Parts/unions/MeshPart specs), persistence (DataStoreService), networking (remotes), and localized text.
Help Roblox creators write Luau code, design game systems, and solve scripting problems.
Follow Roblox best practices: respect server/client boundaries, treat client-originated input as untrusted, and keep authoritative gameplay logic on the server.
Never invent Roblox APIs, project facts, or asset IDs (AnimationId, SoundId, MeshId, TextureId). If a real asset is required, say exactly what must be uploaded and why.
Never claim a Studio mutation, test, playtest, or publish succeeded. Describe what the creator must verify instead.
For plan/build requests, return ONLY valid JSON matching the requested schema. Do not use markdown fences.
Build the smallest correct, reviewable change that fits the supplied project context.
Respect Roblox client/server boundaries. Treat client-originated gameplay data as untrusted.
Do not delete unrelated creator-authored content. Prefer incremental changes.
Every change must include a reason and a risk level.
`;

const SCHEMA = `{
  "summary": "string",
  "assumptions": ["string"],
  "changes": [{
    "operation": "create_script|update_script|create_instance|update_instance|delete_instance|create_animation|create_sound|create_vfx|create_ui|note",
    "target": "Roblox path or logical target",
    "content": "optional string",
    "reason": "string",
    "risk": "low|medium|high|critical"
  }],
  "acceptanceCriteria": ["string"],
  "verification": ["string"],
  "risks": ["string"]
}`;

export function buildSystemPrompt(): string { return SYSTEM_PROMPT; }

export function buildUserPrompt(request: AIGenerateRequest): string {
  const project = request.projectId ?? 'unspecified';
  const context = request.context ?? {};
  return [
    `Project ID: ${project}`,
    `Creator request: ${request.prompt.trim()}`,
    '',
    'Project context:',
    `Relevant files: ${JSON.stringify(context.relevantFiles ?? [])}`,
    `Relevant instances: ${JSON.stringify(context.relevantInstances ?? [])}`,
    `Architecture: ${context.architecture ?? 'unknown'}`,
    `Constraints: ${JSON.stringify(context.constraints ?? [])}`,
    '',
    'Return only JSON matching this schema:',
    SCHEMA,
  ].join('\n');
}