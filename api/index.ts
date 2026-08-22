// LUA-X consolidated API entry point.
//
// EVERY dynamic route is served by this single serverless function so that
// plugin heartbeats, website polls, AI generation, agent events, and vision
// frames all share ONE function instance's memory. This makes the Studio
// <-> website bridge work reliably with zero external state services
// (no Redis required for single-user traffic).
//
// vercel.json rewrites /api/:path* -> this function; the original pathname
// is preserved on request.url, so routing below matches full paths.

export const config = { runtime: 'nodejs', maxDuration: 300 };

import { randomUUID } from 'node:crypto';
import { authorized, rateLimitKey } from './auth';
import { studioHandler } from './studio-handler';
import { handleGenerate } from './ai/generate-handler';

const VERSION = '2.1.0';
const PLUGIN_DOWNLOAD_URL = 'https://raw.githubusercontent.com/Malikiyaw/LUA-X/main/studio-plugin/LUA-X-connected.lua';
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_GENERATE = 60;
const RATE_LIMIT_MAX_POLL = 300;
const RATE_LIMIT_MAX_HEALTH = 300;

const rateStateGenerate = new Map<string, { count: number; resetAt: number }>();
const rateStatePoll = new Map<string, { count: number; resetAt: number }>();

const POLL_PREFIXES = ['/api/studio/', '/studio/'];
const HEALTH_PATHS = new Set(['', '/api', '/api/health', '/health', '/api/ready', '/ready', '/api/ai/status', '/ai/status', '/api/plugin/download', '/plugin/download']);

function rateLimitTier(pathname: string): 'generate' | 'poll' | 'health' {
  if (pathname === '/api/ai/generate' || pathname === '/ai/generate') return 'generate';
  if (HEALTH_PATHS.has(pathname)) return 'health';
  for (const prefix of POLL_PREFIXES) if (pathname.startsWith(prefix)) return 'poll';
  return 'poll';
}

function json(status: number, body: unknown, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extraHeaders },
  });
}

function getClientKey(request: Request): string {
  return rateLimitKey(request.headers, 'anonymous');
}

function consumeRateLimit(key: string, tier: 'generate' | 'poll' | 'health') {
  const limit = tier === 'generate' ? RATE_LIMIT_MAX_GENERATE : tier === 'poll' ? RATE_LIMIT_MAX_POLL : RATE_LIMIT_MAX_HEALTH;
  const store = tier === 'generate' ? rateStateGenerate : tier === 'poll' ? rateStatePoll : rateStatePoll;
  const now = Date.now();
  const existing = store.get(key);
  const state = !existing || existing.resetAt <= now ? { count: 0, resetAt: now + RATE_LIMIT_WINDOW_MS } : existing;
  state.count += 1;
  store.set(key, state);
  return { allowed: state.count <= limit, remaining: Math.max(0, limit - state.count), resetAt: state.resetAt, limit };
}

function getCorsOrigin(request: Request): string {
  const configured = process.env.CORS_ORIGIN?.trim();
  return !configured || configured === '*' ? '*' : configured;
}

function requestId(request: Request): string {
  return request.headers.get('x-request-id') || randomUUID();
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
        'content-disposition': 'attachment; filename="LUA-X.lua"',
        'cache-control': 'no-store, max-age=0',
        'access-control-allow-origin': cors,
        'x-content-type-options': 'nosniff',
      },
    });
  } catch {
    return json(502, { error: 'Unable to download the LUA-X Studio plugin.' }, { 'access-control-allow-origin': cors });
  }
}

async function handler(request: Request): Promise<Response> {
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

    const url = new URL(request.url);
    const pathname = url.pathname.replace(/\/$/, '');
    const tier = rateLimitTier(pathname);
    const rate = consumeRateLimit(getClientKey(request), tier);
    const rateHeaders = {
      'x-ratelimit-limit': String(rate.limit),
      'x-ratelimit-remaining': String(rate.remaining),
      'x-ratelimit-reset': String(Math.ceil(rate.resetAt / 1000)),
    };
    if (!rate.allowed) {
      return json(429, { error: 'Rate limit exceeded.', requestId: id, tier }, {
        ...common,
        ...rateHeaders,
        'retry-after': String(Math.max(1, Math.ceil((rate.resetAt - Date.now()) / 1000))),
      });
    }

    if (request.method === 'GET' && (pathname === '' || pathname === '/api' || pathname === '/api/health' || pathname === '/health')) {
      return json(200, { service: 'lua-x-api', status: 'ok', version: VERSION }, { ...common, ...rateHeaders });
    }

    if (request.method === 'GET' && (pathname === '/api/ready' || pathname === '/ready')) {
      const configured = Boolean(process.env.NVIDIA_API_KEY?.trim()
        || process.env.NVIDIA_API_KEY_1?.trim()
        || process.env.NVIDIA_API_KEY_2?.trim()
        || process.env.NVIDIA_API_KEY_3?.trim()
        || process.env.NVIDIA_API_KEY_4?.trim());
      return json(configured ? 200 : 503, {
        service: 'lua-x-api',
        ready: configured,
        aiProvider: configured ? 'nvidia-configured' : 'not-configured',
        version: VERSION,
      }, { ...common, ...rateHeaders });
    }

    if (request.method === 'GET' && (pathname === '/api/ai/status' || pathname === '/ai/status')) {
      const model = process.env.NVIDIA_MODEL?.trim() || 'nvidia/llama-3.3-nemotron-super-49b-v1';
      const visionModel = process.env.VISION_MODEL?.trim() || 'meta/llama-3.2-90b-vision-instruct';
      return json(200, {
        provider: 'nvidia',
        agents: { architect: process.env.AGENT_MODE === 'single' ? 'single' : 'twin', builder: 'always' },
        model,
        visionModel,
        configured: Boolean(process.env.NVIDIA_API_KEY?.trim()
          || process.env.NVIDIA_API_KEY_1?.trim()
          || process.env.NVIDIA_API_KEY_2?.trim()),
      }, { ...common, ...rateHeaders });
    }

    if (request.method === 'GET' && (pathname === '/api/plugin/download' || pathname === '/plugin/download')) {
      return downloadPlugin(cors);
    }

    if (pathname.startsWith('/api/studio/') || pathname.startsWith('/studio/')) {
      // The bridge shares this function instance — presence, conversations,
      // agent events, and vision frames stay consistent for the web UI.
      const response = await studioHandler(request);
      for (const [key, value] of Object.entries(rateHeaders)) response.headers.set(key, value);
      return response;
    }

    if (request.method === 'POST' && (pathname === '/api/ai/generate' || pathname === '/ai/generate')) {
      if (!authorized(request.headers)) {
        return json(401, { error: 'Unauthorized. Provide a valid LUA-X API token via the Authorization header.', requestId: id }, { ...common, ...rateHeaders });
      }
      const result = await handleGenerate(request);
      for (const [key, value] of Object.entries(rateHeaders)) result.headers.set(key, value);
      return result;
    }

    return json(404, { error: 'Not found.', requestId: id, path: pathname }, { ...common, ...rateHeaders });
  } catch (error) {
    return json(500, {
      error: 'Internal server error.',
      requestId: id,
      detail: error instanceof Error ? error.message : 'Unknown error.',
    }, common);
  }
}

export function GET(request: Request): Promise<Response> {
  return handler(request);
}

export function POST(request: Request): Promise<Response> {
  return handler(request);
}

export function OPTIONS(request: Request): Promise<Response> {
  return handler(request);
}
