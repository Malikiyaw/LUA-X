export const config = { runtime: 'nodejs', maxDuration: 300 };

import { randomUUID } from 'node:crypto';

const DEFAULT_BASE = 'https://integrate.api.nvidia.com/v1';
const DEFAULT_MODELS = [
  'nvidia/llama-3.3-nemotron-super-49b-v1.5',
  'nvidia/llama-3.3-nemotron-super-49b-v1',
];
const BUILD_MODELS = [
  'nvidia/llama-3.3-70b-instruct',
  'nvidia/llama-3.1-8b-instruct',
  ...DEFAULT_MODELS,
];
const MAX_BODY = 128 * 1024;
const MAX_ATTEMPTS_PER_PAIR = 1;
const MODES = new Set(['chat', 'build', 'plan']);
const OPERATIONS = new Set([
  'create_script', 'update_script', 'create_instance', 'update_instance', 'delete_instance',
  'create_animation', 'create_sound', 'create_vfx', 'create_ui', 'note',
]);
const RISKS = new Set(['low', 'medium', 'high', 'critical']);

const CHAT_SYSTEM_PROMPT = [
  'You are LUA-X, an AI-native Roblox development assistant.',
  'Help Roblox creators write Luau code, design game systems, and solve scripting problems.',
  'Follow Roblox best practices: respect server/client boundaries, treat client-originated input as untrusted, and keep authoritative gameplay logic on the server.',
  'Return plain text answers. Put Luau code inside ```lua ... ``` code blocks when code is relevant.',
  'Never claim a Studio mutation, test, playtest, or publish succeeded. Describe what the creator must verify instead.',
  'You can create everything a Roblox experience needs: Luau systems, UI, animations, VFX/particles, sound, 3D geometry, persistence, networking, and localized text.',
  'Never invent asset IDs (AnimationId, SoundId, MeshId, TextureId). If a real asset is required, say exactly what must be uploaded and why.',
].join('\n');

const BUILD_SYSTEM_PROMPT = [
  'You are LUA-X, a Roblox-native AI engineering orchestrator.',
  'Transform creator intent into a minimal, correct, reviewable change plan. You are a coordinated team: Luau engineer, UI engineer, animation director, VFX artist, audio designer, mesh/world engineer, security auditor, performance engineer, playtest engineer, reviewer.',
  'You can create everything a Roblox experience needs: Luau scripts, UI (ScreenGui/Frame/TextButton/ScrollingFrame), animations, VFX (ParticleEmitter/Beam/SurfaceAppearance/Light), sound (Sound/SoundService), 3D geometry (Parts/unions/MeshPart specs), terrain (Terrain API), persistence (DataStoreService), networking (remotes), and localized text.',
  'Every request ships a complete, real, appliable artifact — never an outline or a description. Prefer reusable frameworks with a config module over one-off scripts. Ship named recipes instantly when asked (explosion, fire_loop, slash_trail, hit_spark, shockwave, aura, button, card, toast, cue bank, music sequencer, combat kit) with all values concrete.',
  'Extract art direction (cartoon, fantasy, cyberpunk, minimal, anime, sci-fi) and keep one palette + motion language across UI, VFX, lighting, and materials.',
  'For multi-domain requests (animation + VFX + sound + UI), coordinate them on one millisecond timeline so hit frames line up with VFX bursts, sound cues, and UI feedback.',
  'Prime directive: build the smallest correct solution that satisfies intent, fits the existing project, respects Roblox architecture, and can be verified. Preserve unrelated behavior. Prefer targeted changes.',
  'Truth hierarchy: current creator instruction > explicit project rules > tool-confirmed project state > existing source/architecture > tests > official Roblox docs > memory > general knowledge.',
  'Never invent Roblox APIs, project facts, asset IDs, tool results, test results, or publish results. Asset IDs (AnimationId, SoundId, MeshId, TextureId) are facts, never guesses — if an asset is required but unconfirmed, mark it pending in risks and emit the code/spec with a clearly marked ASSET REQUIRED note instead.',
  'Respect server/client boundaries. Server is authoritative for currency, rewards, damage, inventory, permissions, progression, and cooldowns. Validate client input at the boundary.',
  'Instance property values: use plain numbers/booleans/strings or resolvable forms only: Vector3.new(...), UDim2.new(...), UDim.new(...), Color3.fromRGB(...), BrickColor.new(...), Enum.<Class>.<Name>, NumberRange.new(...), NumberSequence.new(...), ColorSequence.new(...), CFrame.new(...), CFrame.lookAt(...).',
  'For animations: a real Animation instance requires a confirmed AnimationId. Without one, emit a Luau KeyframeSequence builder, an AnimationController module, or procedural motion code, and mark the upload pending. For sounds: a real SoundId is required; otherwise emit a cue-bank/sequencer module and mark assets pending.',
  'UI must be a real Roblox GUI structure or code that creates it: hierarchy, theme tokens, interaction states (default/hover/pressed/disabled/loading/error), empty/loading/failure screen states, responsive layout. Never just describe a UI.',
  'Return ONLY valid JSON with the exact top-level shape in the user message. No markdown fences. No prose outside the JSON.',
  'Never claim that Studio execution, tests, playtests, or publishing succeeded unless evidence is present.',
].join('\n');

const BUILD_SCHEMA = `{
  "summary": "string",
  "assumptions": ["string"],
  "changes": [{
    "operation": "create_script|update_script|create_instance|update_instance|delete_instance|create_animation|create_sound|create_vfx|create_ui|note",
    "target": "Roblox path under game, e.g. game.ServerScriptService.Combat",
    "content": "optional string — full Luau source for create_script/update_script; JSON spec {className, name?, properties} for create_instance/update_instance/create_animation/create_sound/create_vfx/create_ui; omitted for delete_instance/note",
    "reason": "string",
    "risk": "low|medium|high|critical"
  }],
  "acceptanceCriteria": ["string"],
  "verification": ["string"],
  "risks": ["string"]
}`;

interface PlanChange {
  operation: string;
  target: string;
  reason: string;
  risk: string;
  content?: string;
}

interface AIPlan {
  summary: string;
  assumptions: string[];
  changes: PlanChange[];
  acceptanceCriteria: string[];
  verification: string[];
  risks: string[];
}

function json(status: number, payload: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'access-control-allow-origin': '*', ...headers },
  });
}

function requestId(request: Request): string {
  return request.headers.get('x-request-id') || randomUUID();
}

function keys(): string[] {
  const values = [
    process.env.NVIDIA_API_KEY,
    process.env.NVIDIA_API_KEY_1,
    process.env.NVIDIA_API_KEY_2,
    process.env.NVIDIA_API_KEY_3,
    process.env.NVIDIA_API_KEY_4,
  ].map((value) => value?.trim()).filter((value): value is string => Boolean(value));
  return [...new Set(values)];
}

function models(mode: string): string[] {
  const configured = process.env.NVIDIA_MODEL?.trim();
  const fallback = mode === 'chat' ? DEFAULT_MODELS : BUILD_MODELS;
  return configured ? [configured, ...fallback.filter((model) => model !== configured)] : fallback;
}

async function readBody(request: Request): Promise<Record<string, unknown>> {
  const declared = Number(request.headers.get('content-length') || 0);
  if (declared > MAX_BODY) throw new Error('Request body is too large.');
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_BODY) throw new Error('Request body is too large.');
  if (!text.trim()) throw new Error('Request body is required.');
  const value = JSON.parse(text) as unknown;
  if (!value || typeof value !== 'object') throw new Error('Request body must be a JSON object.');
  return value as Record<string, unknown>;
}

function modeOf(body: Record<string, unknown>): string {
  const mode = typeof body.mode === 'string' ? body.mode.trim().toLowerCase() : '';
  return MODES.has(mode) ? mode : 'chat';
}

function validRequest(body: Record<string, unknown>): boolean {
  return typeof body.prompt === 'string' && body.prompt.trim().length >= 2 && body.prompt.length <= 12000
    && (body.projectId === undefined || typeof body.projectId === 'string')
    && (body.mode === undefined || typeof body.mode === 'string')
    && (body.context === undefined || (typeof body.context === 'object' && body.context !== null));
}

function contextBlock(body: Record<string, unknown>): string {
  const context = body.context ?? {};
  return typeof context === 'object' && context !== null && Object.keys(context).length > 0
    ? `\nLive Studio context: ${JSON.stringify(context)}`
    : '';
}

function sessionBlock(body: Record<string, unknown>): string {
  return typeof body.sessionId === 'string' && body.sessionId ? `\nConnected Studio session: ${body.sessionId}` : '';
}

function chatUserPrompt(body: Record<string, unknown>): string {
  const prompt = String(body.prompt ?? '').trim();
  const project = typeof body.projectId === 'string' && body.projectId ? body.projectId : 'unknown';
  return `Project: ${project}\nCreator: ${prompt}${sessionBlock(body)}${contextBlock(body)}`;
}

function buildUserPrompt(body: Record<string, unknown>): string {
  const prompt = String(body.prompt ?? '').trim();
  const project = typeof body.projectId === 'string' && body.projectId ? body.projectId : 'unknown';
  return [
    `Project: ${project}`,
    `Creator request: ${prompt}${sessionBlock(body)}${contextBlock(body)}`,
    '',
    'Return ONLY valid JSON matching this exact schema (no markdown fences):',
    BUILD_SCHEMA,
  ].join('\n');
}

function normalizePlan(text: string): string {
  return text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
}

function extractJson(text: string): unknown {
  const cleaned = normalizePlan(text);
  try {
    return JSON.parse(cleaned);
  } catch {
    // fall through to the balanced-brace scan
  }
  for (let i = 0; i < cleaned.length; i += 1) {
    if (cleaned[i] !== '{') continue;
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let j = i; j < cleaned.length; j += 1) {
      const ch = cleaned[j];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === '\\') {
        escaped = true;
        continue;
      }
      if (ch === '"') {
        inString = !inString;
        continue;
      }
      if (inString) continue;
      if (ch === '{') depth += 1;
      else if (ch === '}') {
        depth -= 1;
        if (depth === 0) {
          try {
            return JSON.parse(cleaned.slice(i, j + 1));
          } catch {
            break;
          }
        }
      }
    }
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parseAIPlan(text: string): AIPlan {
  const parsed = extractJson(text);
  if (parsed === undefined) throw new Error('No valid JSON object found in the AI response.');
  if (!isRecord(parsed)) throw new Error('AI plan must be an object.');

  const { summary, assumptions, changes, acceptanceCriteria, verification, risks } = parsed;
  if (typeof summary !== 'string' || !summary.trim()) throw new Error('AI plan summary is missing.');
  if (!Array.isArray(assumptions) || !assumptions.every((value) => typeof value === 'string')) {
    throw new Error('AI plan assumptions are invalid.');
  }
  if (!Array.isArray(changes)) throw new Error('AI plan changes are invalid.');
  if (!Array.isArray(acceptanceCriteria) || !acceptanceCriteria.every((value) => typeof value === 'string')) {
    throw new Error('AI plan acceptance criteria are invalid.');
  }
  if (!Array.isArray(verification) || !verification.every((value) => typeof value === 'string')) {
    throw new Error('AI plan verification is invalid.');
  }
  if (!Array.isArray(risks) || !risks.every((value) => typeof value === 'string')) {
    throw new Error('AI plan risks are invalid.');
  }

  const validated: PlanChange[] = [];
  for (const item of changes) {
    if (!isRecord(item)) throw new Error('AI plan contains an invalid change proposal.');
    if (typeof item.operation !== 'string' || !OPERATIONS.has(item.operation)) {
      throw new Error('AI plan contains an unsupported operation.');
    }
    if (typeof item.target !== 'string' || !item.target.trim()) throw new Error('Change target is required.');
    if (typeof item.reason !== 'string' || !item.reason.trim()) throw new Error('Change reason is required.');
    if (typeof item.risk !== 'string' || !RISKS.has(item.risk)) throw new Error('Change risk is invalid.');
    if (item.content !== undefined && typeof item.content !== 'string') throw new Error('Change content must be a string.');

    validated.push({
      operation: item.operation,
      target: item.target,
      reason: item.reason,
      risk: item.risk,
      ...(typeof item.content === 'string' ? { content: item.content } : {}),
    });
  }

  return {
    summary,
    assumptions,
    changes: validated,
    acceptanceCriteria,
    verification,
    risks,
  };
}

async function callNvidia(baseUrl: string, model: string, key: string, body: Record<string, unknown>, id: string, mode: string, extraMessages: Array<{ role: 'user'; content: string }> = [], timeoutMs?: number) {
  const configuredMax = Number(process.env.AI_MAX_TOKENS || 0);
  const defaultMax = mode === 'chat' ? 4096 : 8192;
  const maxTokens = configuredMax > 0
    ? Math.min(Math.max(configuredMax, 256), 16384)
    : Math.min(Math.max(defaultMax, 256), 16384);
  const temperature = Math.min(Math.max(Number(process.env.AI_TEMPERATURE || 0.2), 0), 1);
  const defaultTimeout = Math.min(Math.max(Number(process.env.AI_TIMEOUT_MS || 120000), 1000), 120000);
  const effectiveTimeout = timeoutMs !== undefined ? Math.min(Math.max(timeoutMs, 1000), 120000) : defaultTimeout;
  const system = mode === 'chat' ? CHAT_SYSTEM_PROMPT : BUILD_SYSTEM_PROMPT;
  const user = mode === 'chat' ? chatUserPrompt(body) : buildUserPrompt(body);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), effectiveTimeout);
  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${key}`,
        'content-type': 'application/json',
        accept: 'application/json',
        'x-request-id': id,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
          ...extraMessages,
        ],
        max_tokens: maxTokens,
        temperature,
        stream: false,
      }),
      signal: controller.signal,
    });

    const text = await response.text();
    let payload: unknown;
    try { payload = JSON.parse(text); } catch { payload = undefined; }
    const providerError = payload && typeof payload === 'object' && 'error' in payload
      ? (payload as { error?: unknown }).error
      : undefined;
    const message = typeof providerError === 'string'
      ? providerError
      : providerError && typeof providerError === 'object' && 'message' in providerError
        ? String((providerError as { message?: unknown }).message)
        : `NVIDIA returned HTTP ${response.status}.`;

    if (!response.ok) {
      const error = new Error(message) as Error & { status?: number; retryable?: boolean };
      error.status = response.status;
      error.retryable = response.status === 408 || response.status === 429 || response.status >= 500;
      throw error;
    }

    const choices = payload && typeof payload === 'object' ? (payload as { choices?: unknown }).choices : undefined;
    const first = Array.isArray(choices) ? choices[0] : undefined;
    const messageObject = first && typeof first === 'object' ? (first as { message?: unknown }).message : undefined;
    const content = messageObject && typeof messageObject === 'object' ? (messageObject as { content?: unknown }).content : undefined;
    if (typeof content !== 'string' || !content.trim()) throw new Error('NVIDIA returned no assistant content.');
    return { response: content, model, status: 200 };
  } finally {
    clearTimeout(timer);
  }
}

function repairPrompt(text: string, error: Error): string {
  const previous = text.slice(0, 2500);
  return [
    'Your previous response was not accepted as a valid change plan.',
    `Validation error: ${error.message}`,
    '',
    'Return ONLY the corrected JSON object matching the requested schema. No markdown fences, no prose, no explanations, no extra keys.',
    'Previous response (may be truncated):',
    '---',
    previous,
  ].join('\n');
}

function tryPlan(text: string): { plan?: AIPlan; error?: Error } {
  try {
    return { plan: parseAIPlan(text) };
  } catch (error) {
    return { error: error instanceof Error ? error : new Error('Plan parse failed.') };
  }
}

export async function POST(request: Request): Promise<Response> {
  const id = requestId(request);

  try {
    const body = await readBody(request);
    if (!validRequest(body)) return json(400, { error: 'Invalid AI request. Provide a prompt and optional project context.', requestId: id }, { 'x-request-id': id });

    const apiKeys = keys();
    if (!apiKeys.length) return json(503, { error: 'AI provider is not configured on the backend.', requestId: id }, { 'x-request-id': id });

    const mode = modeOf(body);
    const baseUrl = (process.env.NVIDIA_BASE_URL?.trim() || DEFAULT_BASE).replace(/\/$/, '');
    const modelList = models(mode);
    const deadlineMs = Math.min(Math.max(Number(process.env.AI_DEADLINE_MS || 270000), 1000), 285000);
    const startedAt = Date.now();
    const remaining = () => deadlineMs - (Date.now() - startedAt);
    let lastMessage = 'All NVIDIA generation attempts failed.';
    let lastStatus = 502;
    let retriesUsed = 0;

    attempts: for (const model of modelList) {
      for (const key of apiKeys) {
        if (remaining() < 10000) {
          lastMessage = `NVIDIA generation exceeded the ${Math.round(deadlineMs / 1000)}s deadline. Try again or retry later.`;
          break attempts;
        }
        for (let attempt = 1; attempt <= MAX_ATTEMPTS_PER_PAIR; attempt += 1) {
          try {
            const result = await callNvidia(baseUrl, model, key, body, id, mode, [], remaining());
            if (mode !== 'chat') {
              let outcome = tryPlan(result.response);
              if (outcome.error && remaining() >= 60000) {
                try {
                  const repaired = await callNvidia(baseUrl, model, key, body, id, mode, [
                    { role: 'user', content: repairPrompt(result.response, outcome.error) },
                  ], remaining());
                  outcome = tryPlan(repaired.response);
                } catch (repairError) {
                  outcome = { error: repairError instanceof Error ? repairError : new Error('Repair attempt failed.') };
                }
              }
              if (outcome.plan) {
                return json(200, {
                  requestId: id,
                  provider: 'nvidia',
                  model: result.model,
                  plan: outcome.plan,
                  rawTextAvailable: false,
                }, { 'x-request-id': id });
              }
              return json(502, {
                error: 'LUA-X could not parse a valid change plan from the AI response.',
                detail: outcome.error instanceof Error ? outcome.error.message : 'Plan parse failed.',
                requestId: id,
                retryable: true,
                rawText: result.response.slice(0, 4000),
              }, { 'x-request-id': id });
            }
            return json(200, {
              requestId: id,
              provider: 'nvidia',
              model: result.model,
              response: result.response,
              retriesUsed,
            }, { 'x-request-id': id });
          } catch (error) {
            const status = typeof error === 'object' && error !== null && 'status' in error ? Number((error as { status?: unknown }).status) : 502;
            const retryable = typeof error === 'object' && error !== null && 'retryable' in error ? Boolean((error as { retryable?: unknown }).retryable) : true;
            lastStatus = Number.isFinite(status) && status >= 400 && status < 600 ? status : 502;
            lastMessage = error instanceof Error ? error.message : 'NVIDIA request failed.';
            if (!retryable) break;
            retriesUsed += 1;
            if (attempt < MAX_ATTEMPTS_PER_PAIR) await new Promise((resolve) => setTimeout(resolve, Math.min(1200, 350 * attempt)));
          }
        }
      }
    }

    return json(lastStatus >= 500 ? 502 : lastStatus, {
      error: 'LUA-X could not generate a response right now.',
      detail: lastMessage,
      requestId: id,
      retryable: true,
      modelsTried: modelList,
      keysTried: apiKeys.length,
      retriesUsed,
      elapsedMs: Date.now() - startedAt,
    }, { 'x-request-id': id });
  } catch (error) {
    return json(400, { error: error instanceof Error ? error.message : 'Invalid request.', requestId: id }, { 'x-request-id': id });
  }
}

export function OPTIONS(): Response {
  return new Response(null, {
    status: 204,
    headers: { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'POST,OPTIONS', 'access-control-allow-headers': 'content-type,authorization,x-request-id' },
  });
}