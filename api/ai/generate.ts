export const config = { runtime: 'nodejs', maxDuration: 300 };

import { randomUUID } from 'node:crypto';
import { authorized } from '../auth';

const DEFAULT_BASE = 'https://integrate.api.nvidia.com/v1';
const DEFAULT_MODELS = [
  'nvidia/llama-3.3-nemotron-super-49b-v1',
  'nvidia/llama-3.3-nemotron-super-49b-v1.5',
  'meta/llama-3.1-8b-instruct',
];
const BUILD_MODELS = [
  'nvidia/llama-3.3-nemotron-super-49b-v1',
  'meta/llama-3.1-8b-instruct',
  'nvidia/llama-3.3-nemotron-super-49b-v1.5',
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
  'When the creator asks for something buildable (a system, effect, animation, UI, sound cue, or game feature), ship it concretely: real Luau, real instance specs with concrete property values (Vector3.new, UDim2.new, Color3.fromRGB, Enum.<Class>.<Name> — never placeholders), gameplay values in a config module, and respect Roblox budgets.',
  'When the creator asks for a feature, you may end your reply with an appliable change plan as a fenced JSON object (```json ... ```) using this shape: {"summary": "...", "assumptions": [...], "changes": [{"operation": "create_script|update_script|create_instance|update_instance|delete_instance|create_animation|create_sound|create_vfx|create_ui|note", "target": "game path", "content": "...", "reason": "...", "risk": "low|medium|high|critical"}], "acceptanceCriteria": [...], "verification": [...], "risks": [...]}. Only emit it when the plan is complete and appliable — never a placeholder plan.',
  'For a buildable request, always include a plan; the creator can review and apply it in Studio.',
].join('\n');

const BUILD_SYSTEM_PROMPT = [
  'You are LUA-X, a Roblox-native AI engineering orchestrator.',
  'Transform creator intent into a minimal, correct, reviewable change plan. You are a coordinated team: Luau engineer, UI engineer, animation director, VFX artist, audio designer, mesh/world engineer, security auditor, performance engineer, playtest engineer, reviewer.',
  'You can create everything a Roblox experience needs: Luau scripts, UI (ScreenGui/Frame/TextButton/ScrollingFrame), animations, VFX (ParticleEmitter/Beam/SurfaceAppearance/Light), sound (Sound/SoundService), 3D geometry (Parts/unions/MeshPart specs), terrain (Terrain API), persistence (DataStoreService), networking (remotes), and localized text.',
  'Every request ships a complete, real, appliable artifact — never an outline or a description. Prefer reusable frameworks with a config module over one-off scripts. Ship named recipes instantly when asked (explosion, fire_loop, lightning_chain, shield_impact, footprint_steps, beam_trail, glow_pulse, portal, ember_rise, slash_trail, shockwave, aura, charge_up, muzzle_flash, run_cycle, idle_loop, emote_set, attack_chain, dash_blink, hit_reaction, npc_walk, hit_sting, ui_blip, ambience_bed, footstep_map, music_sequencer, minimap, radial_menu, settings_screen, party_hud, context_menu, toast, inventory_grid, hud_bar, vehicle_car, door_double, platformer_kit, furniture_set) with all values concrete.',
  'Quality bars — every artifact must clear all three: (1) one-click playtestable: Play or Apply and the feature works, no dangling TODOs; (2) config-module tunable: damage/speed/duration/colors/cooldowns live in a Config module, not scattered literals; (3) budget-safe: no per-frame Instance.new, no per-frame allocation, no unbounded polling or RemoteEvent spam, particle emitters with sane rate/lifetime.',
  'Extract art direction (cartoon, fantasy, cyberpunk, minimal, anime, sci-fi) and keep one palette + motion language across UI, VFX, lighting, and materials.',
  'For multi-domain requests (animation + VFX + sound + UI), coordinate them on one millisecond timeline so hit frames line up with VFX bursts, sound cues, and UI feedback.',
  'Prime directive: build the smallest correct solution that satisfies intent, fits the existing project, respects Roblox architecture, and can be verified. Preserve unrelated behavior. Prefer targeted changes.',
  'Truth hierarchy: current creator instruction > explicit project rules > tool-confirmed project state > existing source/architecture > tests > official Roblox docs > memory > general knowledge.',
  'Never invent Roblox APIs, project facts, asset IDs, tool results, test results, or publish results. Asset IDs (AnimationId, SoundId, MeshId, TextureId) are facts, never guesses — if an asset is required but unconfirmed, mark it pending in risks and emit the code/spec with a clearly marked ASSET REQUIRED note instead.',
  'Respect server/client boundaries. Server is authoritative for currency, rewards, damage, inventory, permissions, progression, and cooldowns. Validate client input at the boundary.',
  'Instance property values: use plain numbers/booleans/strings or resolvable forms only: Vector3.new(...), UDim2.new(...), UDim.new(...), Color3.fromRGB(...), BrickColor.new(...), Enum.<Class>.<Name>, NumberRange.new(...), NumberSequence.new(...), ColorSequence.new(...), CFrame.new(...), CFrame.lookAt(...). Never put Parent, tween logic, or function calls in a spec — ship a script change for logic.',
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
    "content": "optional string — full Luau source for create_script/update_script; JSON spec {className, name?, properties} for create_instance/update_instance/create_animation/create_sound/create_vfx/create_ui (property values must be plain values or resolvable: Vector3.new, UDim2.new, UDim.new, Color3.fromRGB, BrickColor.new, Enum.<Class>.<Name>, NumberRange.new, NumberSequence.new, ColorSequence.new, CFrame.new, CFrame.lookAt — never function calls, tweens, or Parent); omitted for delete_instance/note",
    "reason": "string",
    "risk": "low|medium|high|critical",
    "dependsOn": "optional string[] — targets this change depends on (applied first)"
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
    && (body.context === undefined || (typeof body.context === 'object' && body.context !== null))
    && validHistory(body);
}

function validHistory(body: Record<string, unknown>): boolean {
  const history = body.history;
  if (history === undefined) return true;
  return Array.isArray(history) && history.length <= 12 && history.every((entry) => isRecord(entry)
    && (entry.role === 'user' || entry.role === 'assistant')
    && typeof entry.content === 'string'
    && entry.content.length <= 12000);
}

function historyMessages(body: Record<string, unknown>): Array<{ role: 'user' | 'assistant'; content: string }> {
  const history = body.history;
  if (!Array.isArray(history)) return [];
  return history
    .filter((entry): entry is { role: 'user' | 'assistant'; content: string } =>
      isRecord(entry) && (entry.role === 'user' || entry.role === 'assistant') && typeof entry.content === 'string')
    .slice(-10)
    .map((entry) => ({ role: entry.role, content: entry.content.slice(0, 12000) }));
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

async function callNvidia(baseUrl: string, model: string, key: string, body: Record<string, unknown>, id: string, mode: string, extraMessages: Array<{ role: 'user'; content: string }> = [], timeoutMs?: number, history: Array<{ role: 'user' | 'assistant'; content: string }> = []) {
  const configuredMax = Number(process.env.AI_MAX_TOKENS || 0);
  const defaultMax = mode === 'chat' ? 4096 : 16384;
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
          ...history,
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
  const previous = text.slice(0, 4000);
  return [
    'Your previous response was not accepted as a valid change plan.',
    `Validation error: ${error.message}`,
    '',
    'If the previous response was cut off mid-JSON (truncated), rebuild the plan COMPACTLY so it fits: fewer changes, shorter content strings, only essential fields. Otherwise fix the specific validation error.',
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

    if (!authorized(request.headers)) {
      return json(401, { error: 'Unauthorized. Provide a valid LUA-X API token via the Authorization header.', requestId: id }, { 'x-request-id': id });
    }

    const apiKeys = keys();
    if (!apiKeys.length) return json(503, { error: 'AI provider is not configured on the backend.', requestId: id }, { 'x-request-id': id });

    const mode = modeOf(body);
    const history = historyMessages(body);
    const baseUrl = (process.env.NVIDIA_BASE_URL?.trim() || DEFAULT_BASE).replace(/\/$/, '');
    const modelList = models(mode);
    const deadlineMs = Math.min(Math.max(Number(process.env.AI_DEADLINE_MS || 270000), 1000), 285000);
    const startedAt = Date.now();
    const remaining = () => deadlineMs - (Date.now() - startedAt);
    let lastMessage = 'All NVIDIA generation attempts failed.';
    let lastStatus = 502;
    let retriesUsed = 0;
    const attemptLog: Array<{ model: string; ms: number; error: string }> = [];

    attempts: for (const model of modelList) {
      for (const key of apiKeys) {
        if (remaining() < 10000) {
          lastMessage = `NVIDIA generation exceeded the ${Math.round(deadlineMs / 1000)}s deadline. Try again or retry later.`;
          break attempts;
        }
        for (let attempt = 1; attempt <= MAX_ATTEMPTS_PER_PAIR; attempt += 1) {
          try {
            const result = await callNvidia(baseUrl, model, key, body, id, mode, [], remaining(), history);
            if (mode !== 'chat') {
              let outcome = tryPlan(result.response);
              let firstError = '';
              if (outcome.error) {
                firstError = outcome.error.message;
                attemptLog.push({ model, ms: Date.now() - startedAt, error: `parse: ${firstError}` });
              }
              if (outcome.error && remaining() >= 60000) {
                try {
                  const repaired = await callNvidia(baseUrl, model, key, body, id, mode, [
                    { role: 'user', content: repairPrompt(result.response, outcome.error) },
                  ], remaining(), history);
                  outcome = tryPlan(repaired.response);
                  if (outcome.error) attemptLog.push({ model, ms: Date.now() - startedAt, error: `parse(repair): ${outcome.error.message}` });
                } catch (repairError) {
                  outcome = { error: new Error(`${firstError} | repair failed: ${repairError instanceof Error ? repairError.message : 'repair call failed'}`) };
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
            if (mode === 'chat') {
              let plan: AIPlan | undefined;
              try {
                const parsed = parseAIPlan(result.response);
                if (parsed.changes.length > 0) plan = parsed;
              } catch {
                // chat responses are free-form; a plan is optional
              }
              return json(200, {
                requestId: id,
                provider: 'nvidia',
                model: result.model,
                response: result.response,
                ...(plan ? { plan } : {}),
                retriesUsed,
              }, { 'x-request-id': id });
            }
            return json(200, {
          } catch (error) {
            const status = typeof error === 'object' && error !== null && 'status' in error ? Number((error as { status?: unknown }).status) : 502;
            const retryable = typeof error === 'object' && error !== null && 'retryable' in error ? Boolean((error as { retryable?: unknown }).retryable) : true;
            lastStatus = Number.isFinite(status) && status >= 400 && status < 600 ? status : 502;
            lastMessage = error instanceof Error ? error.message : 'NVIDIA request failed.';
            attemptLog.push({ model, ms: Date.now() - startedAt, error: `${status}: ${lastMessage}` });
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
      attempts: attemptLog,
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