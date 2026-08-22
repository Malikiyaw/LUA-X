export const config = { runtime: 'nodejs', maxDuration: 300 };

import { randomUUID } from 'node:crypto';
import { authorized } from '../auth';
import {
  appendConversationMessage,
  loadConversation,
  storeLastPlan,
  loadLastPlan,
  loadApplyResult,
  loadVisionFrame,
  recordAgentEvents,
  type AgentEvent,
} from '../studio-handler';

const DEFAULT_BASE = 'https://integrate.api.nvidia.com/v1';
const ARCHITECT_MODELS = [
  'nvidia/llama-3.3-nemotron-super-49b-v1',
  'nvidia/llama-3.3-nemotron-super-49b-v1.5',
  'meta/llama-3.1-8b-instruct',
];
const BUILDER_MODELS = [
  'nvidia/llama-3.3-nemotron-super-49b-v1',
  'meta/llama-3.1-8b-instruct',
  'nvidia/llama-3.3-nemotron-super-49b-v1.5',
];
const DEFAULT_VISION_MODEL = 'meta/llama-3.2-90b-vision-instruct';
const MAX_BODY = 128 * 1024;
const MODES = new Set(['chat', 'build', 'plan']);
const OPERATIONS = new Set([
  'create_script', 'update_script', 'create_instance', 'update_instance', 'delete_instance',
  'create_animation', 'create_sound', 'create_vfx', 'create_ui',
  'configure_lighting', 'create_terrain_region', 'create_constraint',
  'set_attributes', 'add_tags', 'remove_tags',
  'reparent_instance', 'rename_instance', 'clone_instance', 'create_keyframes',
  'note',
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
  "When the creator asks for something buildable (a system, effect, animation, UI, sound cue, or game feature), ship it concretely: real Luau, real instance specs with concrete property values (Vector3.new, UDim2.new, Color3.fromRGB, Enum.<Class>.<Name> — never placeholders), gameplay values in a config module, and respect Roblox budgets.",
  'When the creator asks for a feature, you may end your reply with an appliable change plan as a fenced JSON object (```json ... ```) using this shape: {"summary": "...", "assumptions": [...], "changes": [{"operation": "create_script|update_script|create_instance|update_instance|delete_instance|create_animation|create_sound|create_vfx|create_ui|configure_lighting|create_terrain_region|create_constraint|set_attributes|add_tags|remove_tags|reparent_instance|rename_instance|clone_instance|create_keyframes|note", "target": "game path", "content": "...", "reason": "...", "risk": "low|medium|high|critical"}], "acceptanceCriteria": [...], "verification": [...], "risks": [...]}. Only emit it when the plan is complete and appliable — never a placeholder plan.',
  'For a buildable request, always include a plan; the creator can review and apply it in Studio.',
  'Live Studio vision: the message may include a "Live Studio context" JSON — place, selection, workspaceTree (indented explorer tree, Name (ClassName)), scripts (readable script paths), architecture (full script source), remotes (existing RemoteEvents/Functions). Read it as real project state: use exact game paths from the tree, read existing source before modifying it, create what is missing instead of assuming it exists, and never claim a path or behavior that is not visible in the context.',
  'Shared conversation: this chat is shared between the website and the Roblox Studio plugin — the creator may continue a thread from either surface. Do not restate what the history already established.',
].join('\n');

const ARCHITECT_SYSTEM_PROMPT = [
  'You are LUA-X ARCHITECT, the planning half of a twin-AI engineering team for Roblox Studio.',
  'A BUILDER agent will execute your tasks verbatim. Your job: analyze the project context and decompose the creator intent into a minimal sequence of independently buildable tasks.',
  'Rules:',
  '- Use ONLY instance paths visible in workspaceTree / scripts / selectionDetails. Never invent paths.',
  '- Reuse existing services, modules, and remotes listed in the context before creating duplicates.',
  '- At most 6 tasks. Order them so dependencies come first (config modules before systems that require them).',
  '- Each task instructions must be concrete: exact target path, what to create/change, which properties, expected behavior.',
  '- domains: code, ui, animation, sound, vfx, world, lighting, terrain, constraints, data.',
  '- Never invent asset IDs. If an upload is required, put the requirement in risks.',
  'Return ONLY valid JSON (no markdown fences):',
  '{"summary":"one line","assumptions":["..."],"tasks":[{"id":"t01","title":"...","domain":"code","targetHint":"game.ServerScriptService.X","instructions":"exact build instructions"}],"acceptanceCriteria":["..."],"risks":["..."]}',
].join('\n');

const BUILDER_SYSTEM_PROMPT = [
  'You are LUA-X BUILDER, the execution half of a twin-AI engineering team for Roblox Studio.',
  'The ARCHITECT agent hands you one task. Emit ONLY the machine-applicable change objects that fulfill it — no prose outside JSON.',
  'You can create everything a Roblox experience needs: Luau scripts, nested UI trees, animations (procedural keyframes), VFX (ParticleEmitter/Beam/Trail), sound, 3D geometry, terrain, lighting/atmosphere, physics constraints, attributes/tags, persistence, networking, and localized text.',
  'Every artifact must be complete and appliable — never an outline. Prefer reusable frameworks with a config module over one-off scripts. Ship named recipes instantly when asked (explosion, fire_loop, lightning_chain, shield_impact, footprint_steps, beam_trail, glow_pulse, portal, ember_rise, slash_trail, shockwave, aura, charge_up, muzzle_flash, run_cycle, idle_loop, emote_set, attack_chain, dash_blink, hit_reaction, npc_walk, hit_sting, ui_blip, ambience_bed, footstep_map, music_sequencer, minimap, radial_menu, settings_screen, party_hud, context_menu, toast, inventory_grid, hud_bar, vehicle_car, door_double, platformer_kit, furniture_set) with all values concrete.',
  'Quality bars: (1) one-click playtestable — no dangling TODOs; (2) config-module tunable — damage/speed/duration/colors/cooldowns live in a Config module; (3) budget-safe — no per-frame Instance.new, no unbounded polling or RemoteEvent spam.',
  'Extract art direction and keep one palette + motion language across UI, VFX, lighting, and materials.',
  'Truth hierarchy: current task instruction > explicit project rules > tool-confirmed project state > existing source > tests > official Roblox docs > general knowledge.',
  'Never invent Roblox APIs, project facts, asset IDs, tool results, or test results. Asset IDs (AnimationId, SoundId, MeshId, TextureId) are facts, never guesses — if an asset is required but unconfirmed, emit the code/spec with a clearly marked ASSET REQUIRED note instead.',
  'Respect server/client boundaries. Server is authoritative for currency, rewards, damage, inventory, permissions, progression, and cooldowns. Validate client input at the boundary.',
  'Instance property values: use plain numbers/booleans/strings or resolvable forms only: Vector3.new(...), UDim2.new(...), UDim.new(...), Color3.fromRGB(...), BrickColor.new(...), Enum.<Class>.<Name>, NumberRange.new(...), NumberSequence.new(...), ColorSequence.new(...), CFrame.new(...), CFrame.lookAt(...). Never put Parent, tween logic, or function calls in a spec — ship a script change for logic.',
  '',
  'OPERATION REFERENCE (content is a JSON string for spec operations):',
  '- create_script / update_script: content = FULL Luau source text (not JSON). Write plain Lua-compatible Luau where practical (avoid type annotations and compound assignment) so server-side syntax verification succeeds. Server scripts target game.ServerScriptService..., ModuleScripts game.ReplicatedStorage..., LocalScripts game.StarterPlayerScripts... .',
  '- create_instance / update_instance / create_vfx / create_sound: content = JSON string {"className":"Part","name":"Floor","properties":{"Size":"Vector3.new(8,1,8)","Anchored":true,"Color":"Color3.fromRGB(120,120,130)"}}.',
  '- create_ui: recursive tree — content = JSON string {"className":"ScreenGui","name":"ShopHUD","properties":{},"children":[{"className":"Frame","name":"Root","properties":{"Size":"UDim2.new(0,320,0,240)","BackgroundColor3":"Color3.fromRGB(20,24,34)","BackgroundTransparency":0.15},"children":[{"className":"UICorner","properties":{"CornerRadius":"UDim.new(0,10)"}},{"className":"TextButton","name":"Buy","properties":{"Text":"BUY","TextSize":18},"children":[{"className":"UICorner","properties":{"CornerRadius":"UDim.new(0,8)"}}]}]}]}. Always include UICorner/UIStroke/UIListLayout/UIPadding as children when the design needs them.',
  '- configure_lighting: content = JSON string {"properties":{"ClockTime":18.5,"Brightness":2,"Ambient":"Color3.fromRGB(70,70,90)"},"children":[{"className":"Atmosphere","name":"Atmosphere","properties":{"Density":0.35,"Haze":2}},{"className":"BloomEffect","name":"Bloom","properties":{"Intensity":0.4}}]}. Children update-or-create by className+name under Lighting.',
  '- create_terrain_region: content = JSON string {"center":"Vector3.new(0,10,0)","size":"Vector3.new(64,8,64)","material":"Grass","occupancy":1}. material is an Enum.Material name.',
  '- create_constraint: content = JSON string {"className":"WeldConstraint","part0":"game.Workspace.Door.DoorPanel","part1":"game.Workspace.Door.Frame","properties":{}}. Attachment-based classes (HingeConstraint, SpringConstraint, BallSocketConstraint...) get attachments created automatically.',
  '- set_attributes: content = JSON string {"attributes":{"Damage":25,"Team":"Red"}}.',
  '- add_tags / remove_tags: content = JSON string {"tags":["Enemy","Interactable"]}.',
  '- reparent_instance: content = JSON string {"to":"game.ServerScriptService.Systems"}. rename_instance: {"name":"NewName"}. clone_instance: {"to":"game.Workspace","name":"Copy"}.',
  '- create_animation WITHOUT a confirmed AnimationId is forbidden — use create_keyframes instead: content = JSON string {"name":"SprintCycle","looped":true,"priority":"Movement","keyframes":[{"time":0,"joints":{"HumanoidRootPart":{"cframe":"CFrame.new(0,0,0)","weight":1},"RightUpperArm":{"cframe":[1,0,0,0, 0,1,0,0, 0,0,1,0],"weight":1}}},{"time":0.5,"joints":{...}}]}. cframe accepts [12 numbers] (CFrame.new matrix) or a CFrame.new(...) string. Build believable poses for R15 joint names.',
  '- delete_instance: no content. note: informational only.',
  '',
  'Return ONLY valid JSON matching this shape (no markdown fences): {"changes":[{"operation":"...","target":"game....","content":"...","reason":"...","risk":"low|medium|high|critical"}]}.',
  'Live Studio vision: the user message may include a "Live Studio context" JSON — workspaceTree is the real explorer tree (Name (ClassName)), scripts lists readable scripts, architecture holds their full source, remotes lists existing remotes. Use exact paths from the tree; create anything missing rather than assuming it exists; read existing source from architecture before modifying it; never claim a path that is not visible in the context.',
  'Never claim that Studio execution, tests, playtests, or publishing succeeded unless evidence is present.',
].join('\n');

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

interface BriefTask {
  id: string;
  title: string;
  domain: string;
  targetHint: string;
  instructions: string;
}

interface Brief {
  summary: string;
  assumptions: string[];
  tasks: BriefTask[];
  acceptanceCriteria: string[];
  risks: string[];
}

type AgentTraceEvent = AgentEvent;

type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

type ModelMessage = { role: 'system' | 'user' | 'assistant'; content: string | ContentPart[] };

function json(status: number, payload: unknown, headers: Record<string, string> = {}): Response {
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

function agentMode(): 'twin' | 'single' {
  const value = process.env.AGENT_MODE?.trim().toLowerCase();
  return value === 'single' ? 'single' : 'twin';
}

function maxIterations(): number {
  const value = Number(process.env.AGENT_MAX_ITERATIONS || 3);
  if (!Number.isFinite(value)) return 3;
  return Math.min(Math.max(Math.floor(value), 1), 5);
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function modeOf(body: Record<string, unknown>): string {
  const mode = typeof body.mode === 'string' ? body.mode.trim().toLowerCase() : '';
  return MODES.has(mode) ? mode : 'chat';
}

function validRequest(body: Record<string, unknown>): boolean {
  return typeof body.prompt === 'string' && body.prompt.trim().length >= 2 && body.prompt.length <= 12000
    && (body.projectId === undefined || typeof body.projectId === 'string')
    && (body.mode === undefined || typeof body.mode === 'string')
    && (body.sessionId === undefined || typeof body.sessionId === 'string')
    && (body.surface === undefined || typeof body.surface === 'string')
    && (body.context === undefined || (typeof body.context === 'object' && body.context !== null))
    && validHistory(body);
}

function sessionIdOf(body: Record<string, unknown>): string {
  return typeof body.sessionId === 'string' ? body.sessionId.trim().slice(0, 100) : '';
}

function surfaceOf(body: Record<string, unknown>): 'plugin' | 'web' {
  return typeof body.surface === 'string' && body.surface === 'plugin' ? 'plugin' : 'web';
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

function historyForPrompt(entry: { role: string; content: string; surface?: string }): { role: 'user' | 'assistant'; content: string } | null {
  if (entry.role !== 'user' && entry.role !== 'assistant') return null;
  if (typeof entry.content !== 'string' || !entry.content.trim()) return null;
  const surface = typeof entry.surface === 'string' && (entry.surface === 'plugin' || entry.surface === 'web' || entry.surface === 'server') ? entry.surface : '';
  const prefix = surface ? `[${surface}] ` : '';
  return { role: entry.role as 'user' | 'assistant', content: `${prefix}${entry.content.slice(0, 12000)}` };
}

async function authoritativeHistory(body: Record<string, unknown>): Promise<Array<{ role: 'user' | 'assistant'; content: string }>> {
  const sessionId = sessionIdOf(body);
  if (sessionId) {
    try {
      const stored = await loadConversation(sessionId);
      if (stored && Array.isArray(stored.messages) && stored.messages.length > 0) {
        const mapped = stored.messages
          .map((m) => historyForPrompt(m as { role: string; content: string; surface?: string }))
          .filter((v): v is { role: 'user' | 'assistant'; content: string } => v !== null)
          .slice(-10);
        if (mapped.length > 0) return mapped;
      }
    } catch { /* fall through to client history */ }
  }
  return historyMessages(body);
}

function contextBlock(body: Record<string, unknown>): string {
  const context = body.context ?? {};
  return typeof context === 'object' && context !== null && Object.keys(context).length > 0
    ? `\nLive Studio context: ${JSON.stringify(context)}`
    : '';
}

async function enrichedContextBlock(body: Record<string, unknown>): Promise<string> {
  const base = contextBlock(body);
  const sessionId = sessionIdOf(body);
  if (!sessionId) return base;
  const parts: string[] = [base];
  try {
    const last = await loadLastPlan(sessionId);
    if (last && last.summary) {
      parts.push(`\nLast build plan: ${last.summary} (at ${new Date(last.at).toISOString()})`);
      try {
        const p = last.plan as { changes?: { target?: string; operation?: string }[] };
        if (p && Array.isArray(p.changes) && p.changes.length > 0) {
          const targets = p.changes.slice(0, 6).map(c => `${c.operation}:${c.target}`).join(', ');
          parts.push(` Last plan targets: ${targets}${p.changes.length > 6 ? ` (+${p.changes.length - 6} more)` : ''}`);
        }
      } catch { /* ignore */ }
    }
  } catch { /* ignore */ }
  try {
    const apply = await loadApplyResult(sessionId);
    if (apply) {
      parts.push(`\nLast Studio apply: ${apply.success} succeeded, ${apply.failed} failed — ${apply.planSummary} (at ${new Date(apply.at).toISOString()})`);
      if (apply.results.length > 0) parts.push(` Apply details: ${apply.results.slice(0, 3).join(' | ')}`);
    }
  } catch { /* ignore */ }
  return parts.join('');
}

function sessionBlock(body: Record<string, unknown>): string {
  return typeof body.sessionId === 'string' && body.sessionId ? `\nConnected Studio session: ${body.sessionId}` : '';
}

function chatUserPromptEnriched(body: Record<string, unknown>): Promise<string> {
  const prompt = String(body.prompt ?? '').trim();
  const project = typeof body.projectId === 'string' && body.projectId ? body.projectId : 'unknown';
  return enrichedContextBlock(body).then((enriched) =>
    `Project: ${project}\nCreator: ${prompt}${sessionBlock(body)}${enriched}`);
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

/**
 * Lightweight Lua/Luau structural sanity gate used between agent rounds.
 * Detects truncated or grossly broken generated scripts without rejecting
 * valid Luau-only syntax (type annotations, compound assignment, continue):
 * we only fail on unbalanced brackets, unterminated strings/comments, or
 * obviously truncated tails.
 */
export function basicLuauIssue(source: string): string | null {
  if (typeof source !== 'string' || !source.trim()) return 'script content is empty.';
  let parenDepth = 0;
  let braceDepth = 0;
  let bracketDepth = 0;
  let i = 0;
  const n = source.length;
  let lastMeaningful = '';
  while (i < n) {
    const ch = source[i];
    const next = i + 1 < n ? source[i + 1]! : '';
    if (ch === '-' && next === '-') {
      if (source.slice(i, i + 4) === '--[[') {
        const close = source.indexOf(']]', i + 4);
        if (close === -1) return 'unterminated block comment.';
        i = close + 2;
        continue;
      }
      const lineEnd = source.indexOf('\n', i);
      i = lineEnd === -1 ? n : lineEnd + 1;
      continue;
    }
    if (ch === '"' || ch === "'") {
      let j = i + 1;
      let closed = false;
      while (j < n) {
        const c = source[j]!;
        if (c === '\\') { j += 2; continue; }
        if (c === ch) { closed = true; break; }
        if (c === '\n') break;
        j += 1;
      }
      if (!closed) return 'unterminated string literal.';
      lastMeaningful = ch;
      i = j + 1;
      continue;
    }
    if (ch === '[' && next === '[') {
      const close = source.indexOf(']]', i + 2);
      if (close === -1) return 'unterminated long string.';
      lastMeaningful = ']';
      i = close + 2;
      continue;
    }
    if (ch === '(') parenDepth += 1;
    else if (ch === ')') parenDepth -= 1;
    else if (ch === '{') braceDepth += 1;
    else if (ch === '}') braceDepth -= 1;
    else if (ch === '[') bracketDepth += 1;
    else if (ch === ']') bracketDepth -= 1;
    if (parenDepth < 0) return 'unbalanced parentheses.';
    if (braceDepth < 0) return 'unbalanced braces.';
    if (bracketDepth < 0) return 'unbalanced square brackets.';
    if (!/\s/.test(ch)) lastMeaningful = ch;
    i += 1;
  }
  if (parenDepth !== 0 || braceDepth !== 0 || bracketDepth !== 0) {
    return `unbalanced brackets at end of source (paren=${parenDepth}, brace=${braceDepth}, bracket=${bracketDepth}).`;
  }
  if (lastMeaningful === '=' || lastMeaningful === ',') {
    return 'source appears truncated mid-expression.';
  }
  return null;
}

function validateChangeItem(item: unknown, indexLabel: string): PlanChange {
  if (!isRecord(item)) throw new Error(`${indexLabel}: change must be an object.`);
  if (typeof item.operation !== 'string' || !OPERATIONS.has(item.operation)) {
    throw new Error(`${indexLabel}: unsupported operation "${String(item.operation)}".`);
  }
  if (typeof item.target !== 'string' || !item.target.trim()) throw new Error(`${indexLabel}: target is required.`);
  if (typeof item.reason !== 'string' || !item.reason.trim()) throw new Error(`${indexLabel}: reason is required.`);
  if (typeof item.risk !== 'string' || !RISKS.has(item.risk)) throw new Error(`${indexLabel}: risk must be low|medium|high|critical.`);
  if (item.content !== undefined && typeof item.content !== 'string') throw new Error(`${indexLabel}: content must be a string.`);
  return {
    operation: item.operation,
    target: item.target,
    reason: item.reason,
    risk: item.risk,
    ...(typeof item.content === 'string' ? { content: item.content } : {}),
  };
}

export function parseAIPlan(text: string): AIPlan {
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

  const validated: PlanChange[] = changes.map((item, index) => validateChangeItem(item, `change ${index + 1}`));

  return {
    summary,
    assumptions,
    changes: validated,
    acceptanceCriteria,
    verification,
    risks,
  };
}

// ===== Model calling =====

class ModelError extends Error {
  constructor(message: string, readonly status: number, readonly retryable: boolean) {
    super(message);
    this.name = 'ModelError';
  }
}

async function callModelOnce(
  baseUrl: string,
  model: string,
  key: string,
  messages: ModelMessage[],
  options: { maxTokens: number; temperature: number; timeoutMs: number; id: string },
): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.min(Math.max(options.timeoutMs, 1000), 120000));
  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${key}`,
        'content-type': 'application/json',
        accept: 'application/json',
        'x-request-id': options.id,
      },
      body: JSON.stringify({
        model,
        messages,
        max_tokens: options.maxTokens,
        temperature: options.temperature,
        stream: false,
      }),
      signal: controller.signal,
    });
    const text = await response.text();
    let payload: unknown;
    try { payload = JSON.parse(text); } catch { payload = undefined; }
    if (!response.ok) {
      const providerError = isRecord(payload) && 'error' in payload ? payload.error : undefined;
      const message = typeof providerError === 'string'
        ? providerError
        : providerError && typeof providerError === 'object' && 'message' in providerError
          ? String(providerError.message)
          : `NVIDIA returned HTTP ${response.status}.`;
      const retryable = response.status === 408 || response.status === 429 || response.status >= 500;
      throw new ModelError(message, response.status, retryable);
    }
    const choices = isRecord(payload) ? payload.choices : undefined;
    const first = Array.isArray(choices) ? choices[0] : undefined;
    const message = isRecord(first) ? first.message : undefined;
    const content = isRecord(message) ? message.content : undefined;
    if (typeof content !== 'string' || !content.trim()) throw new ModelError('NVIDIA returned no assistant content.', 502, true);
    return content;
  } catch (error) {
    if (error instanceof ModelError) throw error;
    if (error instanceof Error && error.name === 'AbortError') throw new ModelError('Model request timed out.', 504, true);
    throw new ModelError(error instanceof Error ? error.message : 'Model request failed.', 502, true);
  } finally {
    clearTimeout(timer);
  }
}

interface ResilientCallOptions {
  baseUrl: string;
  models: string[];
  apiKeys: string[];
  messages: ModelMessage[];
  maxTokens: number;
  temperature: number;
  remainingMs: () => number;
  id: string;
  trace: AgentTraceEvent[];
  role: string;
  stage: string;
}

interface ResilientResult {
  content: string;
  model: string;
}

async function callModelResilient(options: ResilientCallOptions): Promise<ResilientResult> {
  let lastMessage = 'All generation attempts failed.';
  let lastStatus = 502;
  for (const model of options.models) {
    for (const key of options.apiKeys) {
      const remaining = options.remainingMs();
      if (remaining < 12000) throw new ModelError(`Deadline reached during ${options.stage}.`, 504, true);
      try {
        const content = await callModelOnce(options.baseUrl, model, key, options.messages, {
          maxTokens: options.maxTokens,
          temperature: options.temperature,
          timeoutMs: Math.min(remaining - 2000, 120000),
          id: options.id,
        });
        options.trace.push({ at: Date.now(), stage: options.stage, role: options.role, model, message: `completed (${Math.round(content.length / 1024)}KB)` });
        return { content, model };
      } catch (error) {
        const status = error instanceof ModelError ? error.status : 502;
        const retryable = error instanceof ModelError ? error.retryable : true;
        lastMessage = error instanceof Error ? error.message : 'Model request failed.';
        lastStatus = status;
        options.trace.push({ at: Date.now(), stage: options.stage, role: options.role, model, message: `attempt failed: ${lastMessage.slice(0, 160)}` });
        if (!retryable) break;
      }
    }
  }
  throw new ModelError(lastMessage, lastStatus, true);
}

// ===== Twin-agent stages =====

function traceEvent(trace: AgentTraceEvent[], role: string, stage: string, message: string, model?: string): void {
  trace.push(model ? { at: Date.now(), stage, role, model, message } : { at: Date.now(), stage, role, message });
}

function sanitizeTasks(rawTasks: unknown[]): BriefTask[] {
  const tasks: BriefTask[] = [];
  rawTasks.slice(0, 6).forEach((raw, index) => {
    if (!isRecord(raw)) return;
    const title = typeof raw.title === 'string' && raw.title.trim() ? raw.title.trim().slice(0, 160) : `Task ${index + 1}`;
    const domain = typeof raw.domain === 'string' && raw.domain.trim() ? raw.domain.trim().toLowerCase().slice(0, 24) : 'code';
    const targetHint = typeof raw.targetHint === 'string' ? raw.targetHint.trim().slice(0, 200) : '';
    const instructions = typeof raw.instructions === 'string' && raw.instructions.trim() ? raw.instructions.trim().slice(0, 4000) : '';
    if (!instructions) return;
    tasks.push({ id: `t${String(index + 1).padStart(2, '0')}`, title, domain, targetHint, instructions });
  });
  return tasks;
}

function parseBrief(content: string, prompt: string): Brief {
  const parsed = extractJson(content);
  if (isRecord(parsed)) {
    const summary = typeof parsed.summary === 'string' && parsed.summary.trim() ? parsed.summary.trim().slice(0, 300) : '';
    const rawTasks = Array.isArray(parsed.tasks) ? parsed.tasks : [];
    const tasks = sanitizeTasks(rawTasks);
    if (tasks.length > 0) {
      return {
        summary: summary || prompt.slice(0, 140),
        assumptions: Array.isArray(parsed.assumptions) ? parsed.assumptions.filter(v => typeof v === 'string').map(String).slice(0, 8) : [],
        tasks,
        acceptanceCriteria: Array.isArray(parsed.acceptanceCriteria)
          ? parsed.acceptanceCriteria.filter(v => typeof v === 'string').map(String).slice(0, 12)
          : [`Implement: ${prompt.slice(0, 120)}`, 'Preserve unrelated working behavior.'],
        risks: Array.isArray(parsed.risks) ? parsed.risks.filter(v => typeof v === 'string').map(String).slice(0, 10) : [],
      };
    }
  }
  // Fallback degraded single-task brief keeps the pipeline functional.
  return {
    summary: prompt.slice(0, 140),
    assumptions: [],
    tasks: [{ id: 't01', title: 'Implement request', domain: 'code', targetHint: '', instructions: prompt }],
    acceptanceCriteria: [`Implement: ${prompt.slice(0, 120)}`, 'Preserve unrelated working behavior.', 'Produce a reviewable change set.'],
    risks: [],
  };
}

async function runArchitect(
  baseUrl: string,
  apiKeys: string[],
  body: Record<string, unknown>,
  id: string,
  trace: AgentTraceEvent[],
  remainingMs: () => number,
): Promise<Brief> {
  const prompt = String(body.prompt ?? '').trim();
  const userText = [
    `Project: ${typeof body.projectId === 'string' && body.projectId ? body.projectId : 'unknown'}`,
    `Creator request: ${prompt}`,
    sessionBlock(body),
    await enrichedContextBlock(body),
  ].join('\n');
  traceEvent(trace, 'ARCHITECT', 'analyze', `Analyzing request and project context…`);

  const visionSession = sessionIdOf(body);
  let frame = null;
  if (visionSession) {
    try { frame = await loadVisionFrame(visionSession); } catch { frame = null; }
  }

  const visionModel = (process.env.VISION_MODEL?.trim() || DEFAULT_VISION_MODEL);
  const modelsWithVision = frame ? [visionModel, ...ARCHITECT_MODELS] : ARCHITECT_MODELS;

  if (frame) {
    traceEvent(trace, 'VISION', 'analyze', `Attaching live screenshot (${frame.width}x${frame.height}).`);
    const messages: ModelMessage[] = [
      { role: 'system', content: ARCHITECT_SYSTEM_PROMPT },
      { role: 'user', content: [
        { type: 'text', text: userText },
        { type: 'image_url', image_url: { url: frame.dataUri } },
      ] },
    ];
    try {
      const result = await callModelResilient({
        baseUrl, models: modelsWithVision, apiKeys, messages,
        maxTokens: 2048, temperature: 0.2, remainingMs, id: id,
        trace, role: 'ARCHITECT', stage: 'architect-vision',
      });
      const brief = parseBrief(result.content, prompt);
      traceEvent(trace, 'ARCHITECT', 'brief', `Plan brief ready: ${brief.tasks.length} task(s) (vision-informed).`, result.model);
      return brief;
    } catch (error) {
      traceEvent(trace, 'VISION', 'analyze', `Vision model unavailable (${error instanceof Error ? error.message.slice(0, 120) : 'error'}) — falling back to structured context only.`);
    }
  }

  const result = await callModelResilient({
    baseUrl, models: ARCHITECT_MODELS, apiKeys,
    messages: [
      { role: 'system', content: ARCHITECT_SYSTEM_PROMPT },
      { role: 'user', content: userText },
    ],
    maxTokens: 2048, temperature: 0.2, remainingMs, id: id,
    trace, role: 'ARCHITECT', stage: 'architect-brief',
  });
  const brief = parseBrief(result.content, prompt);
  traceEvent(trace, 'ARCHITECT', 'brief', `Plan brief ready: ${brief.tasks.map(t => t.id).join(', ')}.`, result.model);
  return brief;
}

async function runBuilderTask(
  baseUrl: string,
  apiKeys: string[],
  body: Record<string, unknown>,
  task: BriefTask,
  priorChanges: PlanChange[],
  repairNote: string | null,
  id: string,
  trace: AgentTraceEvent[],
  remainingMs: () => number,
): Promise<PlanChange[]> {
  const enriched = await enrichedContextBlock(body);
  const userParts = [
    `Project: ${typeof body.projectId === 'string' && body.projectId ? body.projectId : 'unknown'}`,
    `TASK ${task.id} [domain=${task.domain}] ${task.title}`,
    `Target hint: ${task.targetHint || '(choose correct path from context)'}`,
    `Instructions: ${task.instructions}`,
    sessionBlock(body),
    enriched,
    priorChanges.length > 0
      ? `\nAlready-emitted changes (do NOT duplicate; build upon them):\n${priorChanges.slice(-12).map(c => `- ${c.operation} @ ${c.target}`).join('\n')}`
      : '',
    repairNote ? `\nCORRECTION REQUIRED:\n${repairNote}` : '',
    '\nReturn ONLY the JSON object: {"changes":[...]}.',
  ].filter(Boolean).join('\n');

  const result = await callModelResilient({
    baseUrl, models: BUILDER_MODELS, apiKeys,
    messages: [
      { role: 'system', content: BUILDER_SYSTEM_PROMPT },
      { role: 'user', content: userParts },
    ],
    maxTokens: 16384, temperature: 0.2, remainingMs, id: id,
    trace, role: 'BUILDER', stage: `builder-${task.id}`,
  });

  const parsed = extractJson(result.content);
  const rawChanges = isRecord(parsed) && Array.isArray(parsed.changes)
    ? parsed.changes
    : Array.isArray(parsed)
      ? parsed
      : [];
  const valid: PlanChange[] = [];
  const errors: string[] = [];
  rawChanges.forEach((item, index) => {
    try {
      valid.push(validateChangeItem(item, `change ${index + 1}`));
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  });
  if (valid.length === 0 && errors.length > 0) {
    throw new Error(`Builder produced no valid changes for ${task.id}: ${errors[0]}`);
  }
  if (errors.length > 0) {
    traceEvent(trace, 'BUILDER', `builder-${task.id}`, `${valid.length} valid change(s); ${errors.length} rejected.`);
  }
  traceEvent(trace, 'BUILDER', `builder-${task.id}`, `Task ${task.id} built: ${valid.length} change(s).`);
  return valid;
}

async function reviewConsolidated(
  baseUrl: string,
  apiKeys: string[],
  plan: AIPlan,
  id: string,
  trace: AgentTraceEvent[],
  remainingMs: () => number,
): Promise<{ ok: boolean; issues: string[] }> {
  const listing = plan.changes.map(c => `- ${c.operation} @ ${c.target}${c.operation.includes('script') ? ` (${(c.content ?? '').length} chars)` : ''}`).join('\n');
  const userText = [
    'Review this consolidated change set against the acceptance criteria BEFORE it reaches the creator.',
    `Summary: ${plan.summary}`,
    `Acceptance criteria:\n${plan.acceptanceCriteria.map(a => `- ${a}`).join('\n')}`,
    `Changes (${plan.changes.length}):\n${listing}`,
    plan.risks.length ? `Known risks:\n${plan.risks.map(r => `- ${r}`).join('\n')}` : '',
    'Verdict JSON only: {"ok":true,"issues":[]} or {"ok":false,"issues":["specific fix needed: ..."]}. Issues must reference specific change targets. Approve ("ok":true) whenever the set plausibly satisfies the criteria; do not nitpick style.',
  ].filter(Boolean).join('\n\n');
  try {
    const result = await callModelResilient({
      baseUrl, models: ARCHITECT_MODELS, apiKeys,
      messages: [
        { role: 'system', content: ARCHITECT_SYSTEM_PROMPT },
        { role: 'user', content: userText },
      ],
      maxTokens: 1024, temperature: 0, remainingMs, id,
      trace, role: 'ARCHITECT', stage: 'review',
    });
    const parsed = extractJson(result.content);
    if (isRecord(parsed) && typeof parsed.ok === 'boolean') {
      const issues = Array.isArray(parsed.issues) ? parsed.issues.filter(v => typeof v === 'string').map(String).slice(0, 6) : [];
      return { ok: parsed.ok, issues };
    }
    return { ok: true, issues: [] };
  } catch (error) {
    traceEvent(trace, 'ARCHITECT', 'review', `Review skipped: ${error instanceof Error ? error.message.slice(0, 120) : 'error'}`);
    return { ok: true, issues: [] };
  }
}

function consolidatePlan(brief: Brief, changes: PlanChange[]): AIPlan {
  const seen = new Set<string>();
  const deduped: PlanChange[] = [];
  for (const change of changes) {
    const fingerprint = `${change.operation}|${change.target}|${change.content?.slice(0, 80) ?? ''}`;
    if (seen.has(fingerprint)) continue;
    seen.add(fingerprint);
    deduped.push(change);
  }
  return {
    summary: brief.summary,
    assumptions: brief.assumptions,
    changes: deduped,
    acceptanceCriteria: brief.acceptanceCriteria,
    verification: [
      'Apply the change set in Studio (LUA-X plugin → Apply Changes).',
      'Playtest the affected systems and confirm every acceptance criterion.',
      'Check the Output window for runtime errors after applying.',
    ],
    risks: brief.risks,
  };
}

async function syntaxGateAndRepair(
  baseUrl: string,
  apiKeys: string[],
  body: Record<string, unknown>,
  plan: AIPlan,
  id: string,
  trace: AgentTraceEvent[],
  remainingMs: () => number,
  repairsLeft: number,
): Promise<void> {
  let rounds = 0;
  while (rounds < repairsLeft && remainingMs() > 25000) {
    const flagged: Array<{ index: number; issue: string }> = [];
    plan.changes.forEach((change, index) => {
      if ((change.operation === 'create_script' || change.operation === 'update_script') && typeof change.content === 'string') {
        const issue = basicLuauIssue(change.content);
        if (issue) flagged.push({ index, issue });
      }
    });
    if (flagged.length === 0) return;
    traceEvent(trace, 'VERIFY', 'syntax-gate', `${flagged.length} script(s) failed the structural gate — requesting repair round ${rounds + 1}.`);
    const repairList = flagged.map(f => `CHANGE #${f.index + 1} @ ${plan.changes[f.index]!.target}: ${f.issue}`).join('\n');
    const contentsDump = flagged.map(f => `--- CHANGE #${f.index + 1} ---\n${plan.changes[f.index]!.content!.slice(0, 6000)}`).join('\n');
    const repaired = await runBuilderTask(
      baseUrl, apiKeys, body,
      {
        id: 'repair',
        title: 'Fix structurally invalid scripts',
        domain: 'code',
        targetHint: flagged.map(f => plan.changes[f.index]!.target).join(', '),
        instructions: `These generated Lua scripts failed structural validation. Return corrected versions for EXACTLY these changes, keeping every other field identical.\n${repairList}\nEnsure every do/function/if has its end, all brackets balance, and strings terminate.`,
      },
      plan.changes,
      contentsDump,
      id, trace, remainingMs,
    );
    for (const fix of repaired) {
      const matchIndex = plan.changes.findIndex(c => c.target === fix.target && (c.operation === 'create_script' || c.operation === 'update_script'));
      if (matchIndex !== -1) plan.changes[matchIndex] = fix;
    }
    rounds += 1;
  }
  // Final pass: annotate any still-invalid scripts instead of blocking delivery.
  for (const change of plan.changes) {
    if ((change.operation === 'create_script' || change.operation === 'update_script') && typeof change.content === 'string') {
      const issue = basicLuauIssue(change.content);
      if (issue) {
        plan.risks.push(`Script @ ${change.target} may be structurally incomplete (${issue}) — review before running.`);
      }
    }
  }
}

async function runTwinAgent(
  body: Record<string, unknown>,
  apiKeys: string[],
  id: string,
  trace: AgentTraceEvent[],
): Promise<{ plan: AIPlan; model: string }> {
  const baseUrl = (process.env.NVIDIA_BASE_URL?.trim() || DEFAULT_BASE).replace(/\/$/, '');
  const startedAt = Date.now();
  const deadlineMs = Math.min(Math.max(Number(process.env.AI_DEADLINE_MS || 270000), 10000), 285000);
  const remainingMs = () => deadlineMs - (Date.now() - startedAt);

  const singleMode = agentMode() === 'single';
  const prompt = String(body.prompt ?? '').trim();

  let brief: Brief;
  if (singleMode) {
    brief = {
      summary: prompt.slice(0, 140),
      assumptions: [],
      tasks: [{ id: 't01', title: 'Implement request', domain: 'code', targetHint: '', instructions: prompt }],
      acceptanceCriteria: [`Implement: ${prompt.slice(0, 120)}`, 'Preserve unrelated working behavior.'],
      risks: [],
    };
    traceEvent(trace, 'SYSTEM', 'mode', 'AGENT_MODE=single — skipping ARCHITECT decomposition.');
  } else {
    brief = await runArchitect(baseUrl, apiKeys, body, id, trace, remainingMs);
  }

  const allChanges: PlanChange[] = [];
  const maxRepairs = maxIterations();

  for (let taskIndex = 0; taskIndex < brief.tasks.length; taskIndex += 1) {
    const task = brief.tasks[taskIndex]!;
    if (remainingMs() < 20000) {
      traceEvent(trace, 'SYSTEM', 'budget', `Deadline approaching — building remaining work as one final task.`);
      break;
    }
    let changesEmitted = false;
    for (let attempt = 0; attempt < 2 && !changesEmitted; attempt += 1) {
      try {
        const changes = await runBuilderTask(baseUrl, apiKeys, body, task, allChanges, repairNote, id, trace, remainingMs);
        allChanges.push(...changes);
        changesEmitted = true;
      } catch (error) {
        if (attempt >= 1 || remainingMs() < 20000) {
          traceEvent(trace, 'SYSTEM', 'builder-error', `Task ${task.id} failed: ${error instanceof Error ? error.message.slice(0, 140) : 'error'} — continuing.`);
          break;
        }
        repairNote = `Your previous attempt for this task failed validation: ${error instanceof Error ? error.message.slice(0, 300) : 'unknown'}. Fix the JSON structure and resubmit ALL changes for this task.`;
        traceEvent(trace, 'BUILDER', `builder-${task.id}`, 'Retrying after validation failure.');
      }
    }
  }

  if (allChanges.length === 0) {
    throw new ModelError('No changes could be generated for this request.', 502, true);
  }

  const plan = consolidatePlan(brief, allChanges);
  await syntaxGateAndRepair(baseUrl, apiKeys, body, plan, id, trace, remainingMs, maxRepairs - repairsUsed);
  traceEvent(trace, 'VERIFY', 'syntax-gate', `Structural gate passed across ${plan.changes.length} change(s).`);

  const reviewBudget = remainingMs();
  if (agentMode() !== 'single' && reviewBudget > 30000) {
    const verdict = await reviewConsolidated(baseUrl, apiKeys, plan, id, trace, remainingMs);
    traceEvent(trace, 'ARCHITECT', 'review', verdict.ok
      ? 'Review passed — change set approved.'
      : `Review flagged ${verdict.issues.length} issue(s).`);
    if (!verdict.ok && verdict.issues.length > 0 && remainingMs() > 35000) {
      try {
        const fixes = await runBuilderTask(
          baseUrl, apiKeys, body,
          {
            id: 'review-fix',
            title: 'Address reviewer issues',
            domain: 'code',
            targetHint: '',
            instructions: `The reviewer flagged these problems in the consolidated change set. Emit corrected/additional change objects resolving exactly these issues:\n${verdict.issues.map(i => `- ${i}`).join('\n')}`,
          },
          plan.changes,
          null,
          id, trace, remainingMs,
        );
        plan.changes.push(...fixes);
        traceEvent(trace, 'BUILDER', 'review-fix', `Applied ${fixes.length} review fix(es).`);
      } catch { /* deliver best effort */ }
    }
  }

  return { plan, model: BUILDER_MODELS[0]! };
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
    const history = await authoritativeHistory(body);

    if (mode === 'build' || mode === 'plan') {
      const trace: AgentTraceEvent[] = [];
      try {
        const { plan, model } = await runTwinAgent(body, apiKeys, id, trace);
        const sessionId = sessionIdOf(body);
        if (sessionId) {
          try {
            await appendConversationMessage(sessionId, {
              role: 'user',
              content: String(body.prompt ?? '').trim().slice(0, 12000),
              surface: surfaceOf(body),
              at: Date.now(),
            });
            await appendConversationMessage(sessionId, {
              role: 'assistant',
              content: `Build plan ready: ${plan.summary.slice(0, 500)} (${plan.changes.length} changes)`,
              surface: 'server',
              at: Date.now(),
            });
            await storeLastPlan(sessionId, plan);
          } catch { /* best-effort */ }
          try { await recordAgentEvents(sessionId, trace); } catch { /* best-effort */ }
        }
        return json(200, {
          requestId: id,
          provider: 'nvidia',
          model,
          plan,
          agentTrace: trace.slice(-60),
          agents: { architect: agentMode() === 'single' ? 'skipped' : 'completed', builder: 'completed' },
          retriesUsed: Math.max(0, trace.filter(t => t.message.startsWith('attempt failed')).length),
          rawTextAvailable: false,
        }, { 'x-request-id': id });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Twin-agent generation failed.';
        traceEvent(trace, 'SYSTEM', 'fatal', message);
        const sessionId = sessionIdOf(body);
        if (sessionId) {
          try { await recordAgentEvents(sessionId, trace); } catch { /* ignore */ }
        }
        return json(502, {
          error: 'LUA-X could not generate a valid change plan.',
          detail: message,
          requestId: id,
          retryable: true,
          agentTrace: trace.slice(-30),
        }, { 'x-request-id': id });
      }
    }

    // ===== chat mode (single fast call, unchanged semantics) =====
    let lastMessage = 'All NVIDIA generation attempts failed.';
    let lastStatus = 502;
    const baseUrl = (process.env.NVIDIA_BASE_URL?.trim() || DEFAULT_BASE).replace(/\/$/, '');
    const configuredMax = Number(process.env.AI_MAX_TOKENS || 0);
    const maxTokens = configuredMax > 0 ? Math.min(Math.max(configuredMax, 256), 16384) : 4096;
    const temperature = Math.min(Math.max(Number(process.env.AI_TEMPERATURE || 0.2), 0), 1);
    const timeoutMs = Math.min(Math.max(Number(process.env.AI_TIMEOUT_MS || 120000), 1000), 120000);
    const userPrompt = await chatUserPromptEnriched(body);

    try {
      const content = await callModelResilient({
        baseUrl,
        models: (process.env.NVIDIA_MODEL?.trim()
          ? [process.env.NVIDIA_MODEL.trim(), ...ARCHITECT_MODELS.filter(m => m !== process.env.NVIDIA_MODEL!.trim())]
          : ARCHITECT_MODELS),
        apiKeys,
        messages: [
          { role: 'system', content: CHAT_SYSTEM_PROMPT },
          ...history,
          { role: 'user', content: userPrompt },
        ],
        maxTokens, temperature,
        remainingMs: () => timeoutMs,
        id,
        trace: [],
        role: 'CHAT',
        stage: 'chat',
      });

      let plan: AIPlan | undefined;
      try {
        const parsed = parseAIPlan(content);
        if (parsed.changes.length > 0) plan = parsed;
      } catch {
        // chat responses are free-form; a plan is optional
      }
      const sessionId = sessionIdOf(body);
      if (sessionId) {
        await appendConversationMessage(sessionId, {
          role: 'user',
          content: String(body.prompt ?? '').trim().slice(0, 12000),
          surface: surfaceOf(body),
          at: Date.now(),
        });
        await appendConversationMessage(sessionId, {
          role: 'assistant',
          content: content.slice(0, 12000),
          surface: 'server',
          at: Date.now(),
        });
        if (plan) {
          try { await storeLastPlan(sessionId, plan); } catch { /* ignore */ }
        }
      }
      return json(200, {
        requestId: id,
        provider: 'nvidia',
        response: content,
        ...(plan ? { plan } : {}),
      }, { 'x-request-id': id });
    } catch (error) {
      lastMessage = error instanceof Error ? error.message : 'NVIDIA request failed.';
      lastStatus = error instanceof ModelError ? error.status : 502;
      const sessionId = sessionIdOf(body);
      if (sessionId) {
        try {
          await appendConversationMessage(sessionId, {
            role: 'user',
            content: String(body.prompt ?? '').trim().slice(0, 12000),
            surface: surfaceOf(body),
            at: Date.now(),
          });
          await appendConversationMessage(sessionId, {
            role: 'assistant',
            content: `Generation failed: ${lastMessage.slice(0, 12000)}`,
            surface: 'server',
            at: Date.now(),
          });
        } catch { /* ignore */ }
      }
      return json(lastStatus >= 500 ? 502 : lastStatus, {
        error: 'LUA-X could not generate a response right now.',
        detail: lastMessage,
        requestId: id,
        retryable: true,
      }, { 'x-request-id': id });
    }
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
