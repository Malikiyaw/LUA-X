import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { loadConfig } from '../apps/api/dist/config.js';
import { NvidiaApiError, NvidiaClient } from '../apps/api/dist/nvidia.js';
import { FixedWindowRateLimiter } from '../apps/api/dist/rate-limit.js';
import { buildSystemPrompt, buildUserPrompt } from '../apps/api/dist/prompt.js';
import { parseAIPlan } from '../apps/api/dist/schema.js';

let state: {
  config: ReturnType<typeof loadConfig>;
  nvidia: NvidiaClient;
  limiter: FixedWindowRateLimiter;
} | undefined;

function getState() {
  if (!state) {
    const config = loadConfig();
    state = {
      config,
      nvidia: new NvidiaClient({
        ...(config.nvidiaApiKey ? { apiKey: config.nvidiaApiKey } : {}),
        baseUrl: config.nvidiaBaseUrl,
        model: config.nvidiaModel,
        maxTokens: config.aiMaxTokens,
        temperature: config.aiTemperature,
        timeoutMs: config.aiTimeoutMs,
      }),
      limiter: new FixedWindowRateLimiter(config.rateLimitWindowMs, config.rateLimitMaxRequests),
    };
  }
  return state;
}

function json(response: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
  response.statusCode = status;
  response.setHeader('content-type', 'application/json; charset=utf-8');
  response.setHeader('cache-control', 'no-store');
  for (const [key, value] of Object.entries(headers)) response.setHeader(key, value);
  response.end(JSON.stringify(body));
}

async function readBody(request: IncomingMessage, maxBytes = 64 * 1024): Promise<unknown> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.byteLength;
    if (total > maxBytes) throw new Error('Request body is too large.');
    chunks.push(buffer);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw.trim()) throw new Error('Request body is required.');
  return JSON.parse(raw);
}

function isGenerateRequest(value: unknown): value is { prompt: string; projectId?: string; context?: { relevantFiles?: string[]; relevantInstances?: string[]; architecture?: string; constraints?: string[] } } {
  if (typeof value !== 'object' || value === null) return false;
  const body = value as Record<string, unknown>;
  if (typeof body.prompt !== 'string' || body.prompt.trim().length < 2 || body.prompt.length > 12000) return false;
  if (body.projectId !== undefined && typeof body.projectId !== 'string') return false;
  if (body.context !== undefined && (typeof body.context !== 'object' || body.context === null)) return false;
  return true;
}

function clientKey(request: IncomingMessage): string {
  const forwarded = request.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) return forwarded.split(',')[0]?.trim() || 'forwarded';
  return request.socket.remoteAddress ?? 'unknown';
}

export default async function handler(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const requestId = typeof request.headers['x-request-id'] === 'string' && request.headers['x-request-id'].length > 0
    ? request.headers['x-request-id']
    : randomUUID();

  try {
    const current = getState();
    const origin = request.headers.origin;
    const corsOrigin = current.config.corsOrigin === '*' ? '*' : origin === current.config.corsOrigin ? origin : current.config.corsOrigin;
    const headers = { 'x-request-id': requestId, 'access-control-allow-origin': corsOrigin, vary: 'Origin' };

    if (request.method === 'OPTIONS') {
      response.statusCode = 204;
      for (const [key, value] of Object.entries(headers)) response.setHeader(key, value);
      response.setHeader('access-control-allow-methods', 'GET,POST,OPTIONS');
      response.setHeader('access-control-allow-headers', 'content-type,authorization,x-request-id');
      response.end();
      return;
    }

    const rate = current.limiter.consume(clientKey(request));
    const rateHeaders = {
      'x-ratelimit-limit': String(rate.limit),
      'x-ratelimit-remaining': String(rate.remaining),
      'x-ratelimit-reset': String(Math.ceil(rate.resetAt / 1000)),
    };
    if (!rate.allowed) {
      json(response, 429, { error: 'Rate limit exceeded.', requestId }, { ...headers, ...rateHeaders, 'retry-after': String(Math.max(1, Math.ceil((rate.resetAt - Date.now()) / 1000))) });
      return;
    }

    const url = new URL(request.url ?? '/', `https://${request.headers.host ?? 'vercel.invalid'}`);

    if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/health' || url.pathname === '/api/health')) {
      json(response, 200, { service: 'lua-x-api', status: 'ok', version: '0.11.0-alpha' }, { ...headers, ...rateHeaders });
      return;
    }

    if (request.method === 'GET' && (url.pathname === '/ready' || url.pathname === '/api/ready')) {
      const ready = current.nvidia.isConfigured();
      json(response, ready ? 200 : 503, { service: 'lua-x-api', ready, aiProvider: ready ? 'nvidia-configured' : 'not-configured', version: '0.11.0-alpha' }, { ...headers, ...rateHeaders });
      return;
    }

    if (request.method === 'GET' && (url.pathname === '/api/ai/status' || url.pathname === '/ai/status')) {
      json(response, 200, { provider: 'nvidia', configured: current.nvidia.isConfigured(), model: current.config.nvidiaModel }, { ...headers, ...rateHeaders });
      return;
    }

    if (request.method === 'POST' && (url.pathname === '/api/ai/generate' || url.pathname === '/ai/generate')) {
      if (!current.nvidia.isConfigured()) {
        json(response, 503, { error: 'AI provider is not configured on the backend.', requestId }, { ...headers, ...rateHeaders });
        return;
      }
      try {
        const payload = await readBody(request);
        if (!isGenerateRequest(payload)) {
          json(response, 400, { error: 'Invalid AI request. Provide a prompt and optional project context.', requestId }, { ...headers, ...rateHeaders });
          return;
        }
        const result = await current.nvidia.chat([
          { role: 'system', content: buildSystemPrompt() },
          { role: 'user', content: buildUserPrompt(payload) },
        ]);
        const plan = parseAIPlan(result.content);
        json(response, 200, { requestId, provider: 'nvidia', model: result.model ?? current.config.nvidiaModel, plan, rawTextAvailable: false }, { ...headers, ...rateHeaders });
      } catch (error) {
        if (error instanceof SyntaxError) {
          json(response, 400, { error: 'Request body must be valid JSON.', requestId }, { ...headers, ...rateHeaders });
          return;
        }
        if (error instanceof NvidiaApiError) {
          const status = error.status >= 400 && error.status < 600 ? error.status : 502;
          json(response, status, { error: error.message, requestId, retryable: error.retryable }, { ...headers, ...rateHeaders });
          return;
        }
        const message = error instanceof Error ? error.message : 'AI generation failed.';
        json(response, 502, { error: message, requestId }, { ...headers, ...rateHeaders });
        return;
      }
      return;
    }

    json(response, 404, { error: 'Not found.', requestId }, { ...headers, ...rateHeaders });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error.';
    if (!response.headersSent) {
      json(response, 500, { error: 'Internal server error.', requestId, detail: message });
    } else {
      response.destroy(error instanceof Error ? error : undefined);
    }
  }
}
