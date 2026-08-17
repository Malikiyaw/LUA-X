type AIRequest = { prompt?: unknown; projectId?: unknown; context?: unknown };
type ChangeProposal = { operation: 'create_script' | 'update_script' | 'create_instance' | 'update_instance' | 'delete_instance' | 'note'; target: string; reason: string; risk: 'low' | 'medium' | 'high' | 'critical'; content?: string };
type AIPlan = { summary: string; assumptions: string[]; changes: ChangeProposal[]; acceptanceCriteria: string[]; verification: string[]; risks: string[] };

const VERSION = '0.11.0-alpha';
const DEFAULT_BASE_URL = 'https://integrate.api.nvidia.com/v1';
const DEFAULT_MODEL = 'nvidia/llama-3.3-nemotron-super-49b-v1';
const MAX_BODY_BYTES = 64 * 1024;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 30;
const PLUGIN_DOWNLOAD_URL = 'https://raw.githubusercontent.com/Malikiyaw/LUA-X/main/studio-plugin/LUA-X.plugin.lua';
const rateState = new Map<string, { count: number; resetAt: number }>();

function json(status: number, body: unknown, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extraHeaders } });
}
function getClientKey(request: Request): string { return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'anonymous'; }
function consumeRateLimit(key: string) {
  const now = Date.now();
  const existing = rateState.get(key);
  const state = !existing || existing.resetAt <= now ? { count: 0, resetAt: now + RATE_LIMIT_WINDOW_MS } : existing;
  state.count += 1; rateState.set(key, state);
  return { allowed: state.count <= RATE_LIMIT_MAX, remaining: Math.max(0, RATE_LIMIT_MAX - state.count), resetAt: state.resetAt };
}
function getCorsOrigin(request: Request): string { const configured = process.env.CORS_ORIGIN?.trim(); return !configured || configured === '*' ? '*' : request.headers.get('origin') === configured ? configured : configured; }
function requestId(request: Request): string { return request.headers.get('x-request-id') || crypto.randomUUID(); }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null; }
function buildSystemPrompt(): string { return ['You are LUA-X, an AI-native Roblox development engineer.','Return ONLY valid JSON. No Markdown fences and no prose outside JSON.','Produce a safe, reviewable implementation plan.','Never claim Roblox Studio changes were executed or tested.','Preserve existing project architecture and creator-authored code.','Prefer small, targeted changes over destructive rewrites.','Keep authoritative gameplay logic server-side.','JSON shape: {summary, assumptions, changes, acceptanceCriteria, verification, risks}.','Each change uses create_script, update_script, create_instance, update_instance, delete_instance, or note.','Each change includes target, reason, risk; content is optional.'].join('\n'); }
function buildUserPrompt(input: AIRequest): string { const context = typeof input.context === 'object' && input.context !== null ? input.context : {}; return [`Creator request: ${String(input.prompt).trim()}`, `Project ID: ${typeof input.projectId === 'string' ? input.projectId : 'unknown'}`, `Project context: ${JSON.stringify(context)}`].join('\n'); }
function parsePlan(text: string): AIPlan {
  const parsed: unknown = JSON.parse(text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim());
  if (!isRecord(parsed)) throw new Error('AI returned an invalid plan object.');
  const { summary, assumptions, changes, acceptanceCriteria, verification, risks } = parsed;
  if (typeof summary !== 'string' || !summary.trim()) throw new Error('AI plan summary is missing.');
  if (!Array.isArray(assumptions) || !assumptions.every(v => typeof v === 'string')) throw new Error('AI plan assumptions are invalid.');
  if (!Array.isArray(changes)) throw new Error('AI plan changes are invalid.');
  if (!Array.isArray(acceptanceCriteria) || !acceptanceCriteria.every(v => typeof v === 'string')) throw new Error('AI plan acceptance criteria are invalid.');
  if (!Array.isArray(verification) || !verification.every(v => typeof v === 'string')) throw new Error('AI plan verification is invalid.');
  if (!Array.isArray(risks) || !risks.every(v => typeof v === 'string')) throw new Error('AI plan risks are invalid.');
  const operations = new Set<ChangeProposal['operation']>(['create_script','update_script','create_instance','update_instance','delete_instance','note']);
  const risksSet = new Set<ChangeProposal['risk']>(['low','medium','high','critical']);
  const validatedChanges: ChangeProposal[] = [];
  for (const item of changes) {
    if (!isRecord(item) || typeof item.operation !== 'string' || !operations.has(item.operation as ChangeProposal['operation']) || typeof item.target !== 'string' || !item.target.trim() || typeof item.reason !== 'string' || !item.reason.trim() || typeof item.risk !== 'string' || !risksSet.has(item.risk as ChangeProposal['risk'])) throw new Error('AI returned an invalid change proposal.');
    if (item.content !== undefined && typeof item.content !== 'string') throw new Error('AI change content must be a string.');
    const change: ChangeProposal = { operation: item.operation as ChangeProposal['operation'], target: item.target, reason: item.reason, risk: item.risk as ChangeProposal['risk'] };
    if (typeof item.content === 'string') change.content = item.content;
    validatedChanges.push(change);
  }
  return { summary, assumptions, changes: validatedChanges, acceptanceCriteria, verification, risks };
}
async function readJson(request: Request): Promise<unknown> { const contentLength = Number(request.headers.get('content-length') || '0'); if (contentLength > MAX_BODY_BYTES) throw new Error('Request body is too large.'); const text = await request.text(); if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) throw new Error('Request body is too large.'); if (!text.trim()) throw new Error('Request body is required.'); return JSON.parse(text); }
function validGenerateRequest(value: unknown): value is AIRequest { if (!isRecord(value)) return false; if (typeof value.prompt !== 'string' || value.prompt.trim().length < 2 || value.prompt.length > 12000) return false; if (value.projectId !== undefined && typeof value.projectId !== 'string') return false; if (value.context !== undefined && !isRecord(value.context)) return false; return true; }

async function downloadPlugin(cors: string): Promise<Response> {
  try {
    const upstream = await fetch(PLUGIN_DOWNLOAD_URL, { headers: { accept: 'text/plain,*/*' }, cache: 'no-store' });
    if (!upstream.ok) return json(502, { error: 'Unable to retrieve the current LUA-X Studio plugin.', status: upstream.status }, { 'access-control-allow-origin': cors });
    const content = await upstream.text();
    return new Response(content, {
      status: 200,
      headers: {
        'content-type': 'application/octet-stream',
        'content-disposition': 'attachment; filename="LUA-X.plugin.lua"',
        'cache-control': 'no-store, max-age=0',
        'access-control-allow-origin': cors,
        'x-content-type-options': 'nosniff',
      },
    });
  } catch {
    return json(502, { error: 'Unable to download the LUA-X Studio plugin.' }, { 'access-control-allow-origin': cors });
  }
}

async function generate(request: Request, id: string, cors: string): Promise<Response> {
  const apiKey = process.env.NVIDIA_API_KEY?.trim();
  if (!apiKey) return json(503, { error: 'AI provider is not configured.', requestId: id }, { 'x-request-id': id, 'access-control-allow-origin': cors });
  const body = await readJson(request);
  if (!validGenerateRequest(body)) return json(400, { error: 'Invalid AI request.', requestId: id }, { 'x-request-id': id, 'access-control-allow-origin': cors });
  const baseUrl = (process.env.NVIDIA_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(/\/$/, '');
  const model = process.env.NVIDIA_MODEL?.trim() || DEFAULT_MODEL;
  const maxTokens = Math.min(Math.max(Number(process.env.AI_MAX_TOKENS || 4096), 256), 16384);
  const temperature = Math.min(Math.max(Number(process.env.AI_TEMPERATURE || 0.2), 0), 1);
  const timeoutMs = Math.min(Math.max(Number(process.env.AI_TIMEOUT_MS || 60000), 1000), 120000);
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const upstream = await fetch(`${baseUrl}/chat/completions`, { method:'POST', headers:{ authorization:`Bearer ${apiKey}`, 'content-type':'application/json', accept:'application/json' }, body:JSON.stringify({ model, messages:[{ role:'system', content:buildSystemPrompt() },{ role:'user', content:buildUserPrompt(body) }], max_tokens:maxTokens, temperature, stream:false }), signal:controller.signal });
    const raw = await upstream.text(); let payload: unknown; try { payload = JSON.parse(raw); } catch { payload = undefined; }
    if (!upstream.ok) { const message = isRecord(payload) && 'error' in payload ? String(payload.error) : `NVIDIA returned HTTP ${upstream.status}.`; return json(upstream.status >= 400 && upstream.status < 600 ? upstream.status : 502, { error:message, requestId:id, retryable:upstream.status === 408 || upstream.status === 429 || upstream.status >= 500 }, { 'x-request-id':id, 'access-control-allow-origin':cors }); }
    const choices = isRecord(payload) ? payload.choices : undefined; const firstChoice = Array.isArray(choices) ? choices[0] : undefined; const message = isRecord(firstChoice) ? firstChoice.message : undefined; const content = isRecord(message) ? message.content : undefined;
    if (typeof content !== 'string' || !content.trim()) throw new Error('NVIDIA returned no assistant content.');
    const plan = parsePlan(content);
    return json(200, { requestId:id, provider:'nvidia', model, plan, rawTextAvailable:false }, { 'x-request-id':id, 'access-control-allow-origin':cors });
  } catch (error) {
    const message = error instanceof Error && error.name === 'AbortError' ? 'AI request timed out.' : error instanceof Error ? error.message : 'AI request failed.';
    return json(502, { error:message, requestId:id, retryable:true }, { 'x-request-id':id, 'access-control-allow-origin':cors });
  } finally { clearTimeout(timer); }
}

export default async function handler(request: Request): Promise<Response> {
  const id = requestId(request); const cors = getCorsOrigin(request); const common = { 'x-request-id':id, 'access-control-allow-origin':cors, vary:'Origin' };
  try {
    if (request.method === 'OPTIONS') return new Response(null, { status:204, headers:{ ...common, 'access-control-allow-methods':'GET,POST,OPTIONS', 'access-control-allow-headers':'content-type,authorization,x-request-id' } });
    const rate = consumeRateLimit(getClientKey(request)); const rateHeaders = { 'x-ratelimit-limit':String(RATE_LIMIT_MAX), 'x-ratelimit-remaining':String(rate.remaining), 'x-ratelimit-reset':String(Math.ceil(rate.resetAt/1000)) };
    if (!rate.allowed) return json(429, { error:'Rate limit exceeded.', requestId:id }, { ...common, ...rateHeaders, 'retry-after':String(Math.max(1, Math.ceil((rate.resetAt-Date.now())/1000))) });
    const url = new URL(request.url);
    if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/health' || url.pathname === '/api/health')) return json(200, { service:'lua-x-api', status:'ok', version:VERSION }, { ...common, ...rateHeaders });
    if (request.method === 'GET' && (url.pathname === '/ready' || url.pathname === '/api/ready')) { const configured = Boolean(process.env.NVIDIA_API_KEY?.trim()); return json(configured ? 200 : 503, { service:'lua-x-api', ready:configured, aiProvider:configured?'nvidia-configured':'not-configured', version:VERSION }, { ...common, ...rateHeaders }); }
    if (request.method === 'GET' && (url.pathname === '/api/ai/status' || url.pathname === '/ai/status')) return json(200, { provider:'nvidia', configured:Boolean(process.env.NVIDIA_API_KEY?.trim()), model:process.env.NVIDIA_MODEL?.trim() || DEFAULT_MODEL }, { ...common, ...rateHeaders });
    if (request.method === 'GET' && (url.pathname === '/api/plugin/download' || url.pathname === '/plugin/download')) return downloadPlugin(cors);
    if (request.method === 'POST' && (url.pathname === '/api/ai/generate' || url.pathname === '/ai/generate')) { const result = await generate(request, id, cors); for (const [key,value] of Object.entries(rateHeaders)) result.headers.set(key,value); return result; }
    return json(404, { error:'Not found.', requestId:id }, { ...common, ...rateHeaders });
  } catch (error) { return json(500, { error:'Internal server error.', requestId:id, detail:error instanceof Error ? error.message : 'Unknown error.' }, common); }
}
