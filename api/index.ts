import { randomUUID } from 'node:crypto';

type ChatRequest = { prompt?: unknown; projectId?: unknown; context?: unknown; mode?: unknown };

const VERSION = '0.11.0-chat';
const DEFAULT_BASE_URL = 'https://integrate.api.nvidia.com/v1';
const DEFAULT_MODEL = 'nvidia/llama-3.3-nemotron-super-49b-v1';
const MAX_BODY_BYTES = 128 * 1024;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 60;
const PLUGIN_DOWNLOAD_URL = 'https://raw.githubusercontent.com/Malikiyaw/LUA-X/main/studio-plugin/LUA-X.plugin.lua';

const rateState = new Map<string, { count: number; resetAt: number }>();

const SYSTEM_PROMPT = [
  'You are LUA-X, an AI-native Roblox development assistant.',
  'Help Roblox creators write Luau code, design game systems, and solve scripting problems.',
  'Follow Roblox best practices: respect server/client boundaries, treat client-originated input as untrusted, and keep authoritative gameplay logic on the server.',
  'Return plain text answers. Put Luau code inside ```lua ... ``` code blocks when code is relevant.',
  'Never claim a Studio mutation, test, playtest, or publish succeeded. Describe what the creator must verify instead.',
].join('\n');

function json(status: number, body: unknown, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extraHeaders },
  });
}

function getClientKey(request: Request): string {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'anonymous';
}

function consumeRateLimit(key: string) {
  const now = Date.now();
  const existing = rateState.get(key);
  const state = !existing || existing.resetAt <= now ? { count: 0, resetAt: now + RATE_LIMIT_WINDOW_MS } : existing;
  state.count += 1;
  rateState.set(key, state);
  return { allowed: state.count <= RATE_LIMIT_MAX, remaining: Math.max(0, RATE_LIMIT_MAX - state.count), resetAt: state.resetAt };
}

function getCorsOrigin(request: Request): string {
  const configured = process.env.CORS_ORIGIN?.trim();
  return !configured || configured === '*' ? '*' : request.headers.get('origin') === configured ? configured : configured;
}

function requestId(request: Request): string {
  return request.headers.get('x-request-id') || randomUUID();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function buildUserPrompt(input: ChatRequest): string {
  const prompt = String(input.prompt ?? '').trim();
  const project = typeof input.projectId === 'string' && input.projectId ? input.projectId : 'unknown';
  const context = isRecord(input.context) ? input.context : {};
  const contextText = Object.keys(context).length > 0 ? `\nProject context: ${JSON.stringify(context)}` : '';
  return `Project: ${project}\nCreator: ${prompt}${contextText}`;
}

async function readJson(request: Request): Promise<unknown> {
  const contentLength = Number(request.headers.get('content-length') || '0');
  if (contentLength > MAX_BODY_BYTES) throw new Error('Request body is too large.');
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) throw new Error('Request body is too large.');
  if (!text.trim()) throw new Error('Request body is required.');
  return JSON.parse(text);
}

function validGenerateRequest(value: unknown): value is ChatRequest {
  if (!isRecord(value)) return false;
  if (typeof value.prompt !== 'string' || value.prompt.trim().length < 2 || value.prompt.length > 12000) return false;
  if (value.projectId !== undefined && typeof value.projectId !== 'string') return false;
  if (value.context !== undefined && !isRecord(value.context)) return false;
  return true;
}

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
  if (!apiKey) {
    return json(503, { error: 'AI provider is not configured.', requestId: id }, { 'x-request-id': id, 'access-control-allow-origin': cors });
  }
  const body = await readJson(request);
  if (!validGenerateRequest(body)) {
    return json(400, { error: 'Invalid AI request.', requestId: id }, { 'x-request-id': id, 'access-control-allow-origin': cors });
  }

  const baseUrl = (process.env.NVIDIA_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(/\/$/, '');
  const model = process.env.NVIDIA_MODEL?.trim() || DEFAULT_MODEL;
  const maxTokens = Math.min(Math.max(Number(process.env.AI_MAX_TOKENS || 4096), 256), 16384);
  const temperature = Math.min(Math.max(Number(process.env.AI_TEMPERATURE || 0.2), 0), 1);
  const timeoutMs = Math.min(Math.max(Number(process.env.AI_TIMEOUT_MS || 60000), 1000), 120000);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const upstream = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: buildUserPrompt(body) },
        ],
        max_tokens: maxTokens,
        temperature,
        stream: false,
      }),
      signal: controller.signal,
    });

    const raw = await upstream.text();
    let payload: unknown;
    try {
      payload = JSON.parse(raw);
    } catch {
      payload = undefined;
    }

    if (!upstream.ok) {
      const message = isRecord(payload) && 'error' in payload ? String(payload.error) : `NVIDIA returned HTTP ${upstream.status}.`;
      return json(upstream.status >= 400 && upstream.status < 600 ? upstream.status : 502, {
        error: message,
        requestId: id,
        retryable: upstream.status === 408 || upstream.status === 429 || upstream.status >= 500,
      }, { 'x-request-id': id, 'access-control-allow-origin': cors });
    }

    const choices = isRecord(payload) ? payload.choices : undefined;
    const firstChoice = Array.isArray(choices) ? choices[0] : undefined;
    const message = isRecord(firstChoice) ? firstChoice.message : undefined;
    const content = isRecord(message) ? message.content : undefined;

    if (typeof content !== 'string' || !content.trim()) {
      throw new Error('NVIDIA returned no assistant content.');
    }

    return json(200, { requestId: id, provider: 'nvidia', model, response: content }, { 'x-request-id': id, 'access-control-allow-origin': cors });
  } catch (error) {
    const message = error instanceof Error && error.name === 'AbortError'
      ? 'AI request timed out.'
      : error instanceof Error
        ? error.message
        : 'AI request failed.';
    return json(502, { error: message, requestId: id, retryable: true }, { 'x-request-id': id, 'access-control-allow-origin': cors });
  } finally {
    clearTimeout(timer);
  }
}

export default async function handler(request: Request): Promise<Response> {
  const id = requestId(request);
  const cors = getCorsOrigin(request);
  const common = { 'x-request-id': id, 'access-control-allow-origin': cors, vary: 'Origin' };

  try {
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: { ...common, 'access-control-allow-methods': 'GET,POST,OPTIONS', 'access-control-allow-headers': 'content-type,authorization,x-request-id' },
      });
    }

    const rate = consumeRateLimit(getClientKey(request));
    const rateHeaders = {
      'x-ratelimit-limit': String(RATE_LIMIT_MAX),
      'x-ratelimit-remaining': String(rate.remaining),
      'x-ratelimit-reset': String(Math.ceil(rate.resetAt / 1000)),
    };
    if (!rate.allowed) {
      return json(429, { error: 'Rate limit exceeded.', requestId: id }, {
        ...common,
        ...rateHeaders,
        'retry-after': String(Math.max(1, Math.ceil((rate.resetAt - Date.now()) / 1000))),
      });
    }

    const url = new URL(request.url);

    if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/health' || url.pathname === '/api/health')) {
      return json(200, { service: 'lua-x-api', status: 'ok', version: VERSION }, { ...common, ...rateHeaders });
    }

    if (request.method === 'GET' && (url.pathname === '/ready' || url.pathname === '/api/ready')) {
      const configured = Boolean(process.env.NVIDIA_API_KEY?.trim());
      return json(configured ? 200 : 503, {
        service: 'lua-x-api',
        ready: configured,
        aiProvider: configured ? 'nvidia-configured' : 'not-configured',
        version: VERSION,
      }, { ...common, ...rateHeaders });
    }

    if (request.method === 'GET' && (url.pathname === '/api/ai/status' || url.pathname === '/ai/status')) {
      return json(200, {
        provider: 'nvidia',
        configured: Boolean(process.env.NVIDIA_API_KEY?.trim()),
        model: process.env.NVIDIA_MODEL?.trim() || DEFAULT_MODEL,
      }, { ...common, ...rateHeaders });
    }

    if (request.method === 'GET' && (url.pathname === '/api/plugin/download' || url.pathname === '/plugin/download')) {
      return downloadPlugin(cors);
    }

    if (request.method === 'POST' && (url.pathname === '/api/ai/generate' || url.pathname === '/ai/generate')) {
      const result = await generate(request, id, cors);
      for (const [key, value] of Object.entries(rateHeaders)) result.headers.set(key, value);
      return result;
    }

    return json(404, { error: 'Not found.', requestId: id }, { ...common, ...rateHeaders });
  } catch (error) {
    return json(500, {
      error: 'Internal server error.',
      requestId: id,
      detail: error instanceof Error ? error.message : 'Unknown error.',
    }, common);
  }
}
