import type { AIGenerateRequest } from './schema.js';

const SYSTEM_PROMPT = `You are LUA-X, a Roblox-native AI engineering orchestrator.
Return ONLY valid JSON matching the requested schema. Do not use markdown fences.
Build the smallest correct, reviewable change that fits the supplied project context.
Never invent Roblox APIs, asset IDs, project facts, or successful tool results.
Respect Roblox client/server boundaries. Treat client-originated gameplay data as untrusted.
Do not delete unrelated creator-authored content. Prefer incremental changes.
Every change must include a reason and a risk level.
`;

const SCHEMA = `{
  "summary": "string",
  "assumptions": ["string"],
  "changes": [{
    "operation": "create_script|update_script|create_instance|update_instance|delete_instance|note",
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
