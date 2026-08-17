import { generateAIPlan, type AIRequest } from '@lua-x/api-core';
import { NvidiaApiError, NvidiaClientPool } from '@lua-x/nvidia-provider';

const VERSION = '0.11.0-alpha';
const DEFAULT_BASE_URL = 'https://integrate.api.nvidia.com/v1';
const DEFAULT_MODEL = 'nvidia/llama-3.3-nemotron-super-49b-v1';
const MAX_BODY_BYTES = 64 * 1024;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 30;

const rateState = new Map<string, { count: number; resetAt: number }>();
let pool: NvidiaClientPool | undefined;

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...headers,
    },
  });
}

function readKeys(): string[] {
  const values = [
    process.env.NVIDIA_API_KEYS,
    process.env.NVIDIA_API_KEY,
    process.env.NVIDIA_API_KEY_1,
    process.env.NVIDIA_API_KEY_2,
    process.env.NVIDIA_API_KEY_3,
    process.env.NVIDIA_API_KEY_4,
  ];
  return [...new Set(values
    .flatMap((value) => (value ?? '').split(','))
    .map((value) => value.trim())
    .filter(Boolean))];
}

function getPool(): NvidiaClientPool {
  if (pool) return pool;
  pool = new NvidiaClientPool({
    apiKeys: readKeys(),
    baseUrl: (process.env.NVIDIA_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(/\/$/, ''),
    model: process.env.NVIDIA_MODEL?.trim() || DEFAULT_MODEL,
    maxTokens: Math.min(Math.max(Number(process.env.AI_MAX_TOKENS || 4096), 256), 16384),
    temperature: Math.min(Math.max(Number(process.env.AI_TEMPERATURE || 0.2), 0), 1),
    timeoutMs: Math.min(Math.max(Number(process.env.AI_TIMEOUT_MS || 60000), 1000), 120000),
  });
  return pool;
}

function getPoolSafe(): NvidiaClientPool | null {
  try {
    return getPool();
  } catch {
    return null;
  }
}

function requestId(request: Request): string {
  return request.headers.get('x-request-id') || crypto.randomUUID();
}

function corsOrigin(request: Request): string {
  const configured = process.env.CORS_ORIGIN?.trim();
  if (!configured || configured === '*') return '*';
  return request.headers.get('origin') === configured ? configured : configured;
}

function consumeRateLimit(key: string) {
  const now = Date.now();
  const existing = rateState.get(key);
  const state = !existing || existing.resetAt <= now
    ? { count: 0, resetAt: now + RATE_LIMIT_WINDOW_MS }
    : existing;
  state.count += 1;
  rateState.set(key, state);
  return {
    allowed: state.count <= RATE_LIMIT_MAX,
    remaining: Math.max(0, RATE_LIMIT_MAX - state.count),
    resetAt: state.resetAt,
  };
}

function clientKey(request: Request): string {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'anonymous';
}

async function readJson(request: Request): Promise<unknown> {
  const contentLength = Number(request.headers.get('content-length') || '0');
  if (contentLength > MAX_BODY_BYTES) throw new Error('Request body is too large.');
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) throw new Error('Request body is too large.');
  if (!text.trim()) throw new Error('Request body is required.');
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('Request body must be valid JSON.');
  }
}

function isGenerateRequest(value: unknown): value is AIRequest {
  if (typeof value !== 'object' || value === null) return false;
  const body = value as Record<string, unknown>;
  if (typeof body.prompt !== 'string' || body.prompt.trim().length < 2 || body.prompt.length > 12000) return false;
  if (body.projectId !== undefined && typeof body.projectId !== 'string') return false;
  if (body.mode !== undefined && !['plan', 'build', 'verify', 'repair'].includes(String(body.mode))) return false;
  if (body.context !== undefined && (typeof body.context !== 'object' || body.context === null)) return false;
  return true;
}

export default async function handler(request: Request): Promise<Response> {
  const id = requestId(request);
  const cors = corsOrigin(request);
  const common = { 'x-request-id': id, 'access-control-allow-origin': cors, vary: 'Origin' };

  try {
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          ...common,
          'access-control-allow-methods': 'GET,POST,OPTIONS',
          'access-control-allow-headers': 'content-type,authorization,x-request-id',
        },
      });
    }

    const rate = consumeRateLimit(clientKey(request));
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
    const currentPool = getPoolSafe();

    if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/health' || url.pathname === '/api/health')) {
      return json(200, {
        service: 'lua-x-api',
        status: 'ok',
        version: VERSION,
        aiKeysConfigured: currentPool?.size ?? 0,
      }, { ...common, ...rateHeaders });
    }

    if (request.method === 'GET' && (url.pathname === '/ready' || url.pathname === '/api/ready')) {
      const configured = Boolean(currentPool?.isConfigured());
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
        configured: Boolean(currentPool?.isConfigured()),
        keyPoolSize: currentPool?.size ?? 0,
        model: process.env.NVIDIA_MODEL?.trim() || DEFAULT_MODEL,
      }, { ...common, ...rateHeaders });
    }

    if (request.method === 'POST' && (url.pathname === '/api/ai/generate' || url.pathname === '/ai/generate')) {
      if (!currentPool?.isConfigured()) {
        return json(503, { error: 'AI provider is not configured on the backend.', requestId: id }, { ...common, ...rateHeaders });
      }

      const payload = await readJson(request);
      if (!isGenerateRequest(payload)) {
        return json(400, { error: 'Invalid AI request. Provide a prompt and optional project context.', requestId: id }, { ...common, ...rateHeaders });
      }

      try {
        const generated = await generateAIPlan(payload, currentPool);
        return json(200, {
          requestId: generated.requestId ?? id,
          provider: generated.provider,
          model: generated.model ?? (process.env.NVIDIA_MODEL?.trim() || DEFAULT_MODEL),
          plan: generated.plan,
          pipeline: generated.pipeline,
          rawTextAvailable: false,
        }, { ...common, ...rateHeaders });
      } catch (error) {
        if (error instanceof NvidiaApiError) {
          const status = error.status >= 400 && error.status < 600 ? error.status : 502;
          return json(status, { error: error.message, requestId: id, retryable: error.retryable }, { ...common, ...rateHeaders });
        }
        throw error;
      }
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
