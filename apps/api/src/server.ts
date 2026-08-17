import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { loadConfig } from './config.js';
import { FixedWindowRateLimiter } from './rate-limit.js';
import { NvidiaApiError, NvidiaClient } from './nvidia.js';
import { buildSystemPrompt, buildUserPrompt } from './prompt.js';
import { parseAIPlan, type AIGenerateRequest } from './schema.js';

export const API_VERSION = '0.11.0-alpha';

export interface ApiDependencies { config: ReturnType<typeof loadConfig>; nvidia: NvidiaClient; limiter: FixedWindowRateLimiter }

function sendJson(response: ServerResponse, status: number, payload: unknown, headers: Record<string, string> = {}): void {
  const body = JSON.stringify(payload);
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers });
  response.end(body);
}

async function readJson(request: IncomingMessage, maxBytes = 64 * 1024): Promise<unknown> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk);
    size += buffer.byteLength;
    if (size > maxBytes) throw new Error('Request body is too large.');
    chunks.push(buffer);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  if (!text.trim()) throw new Error('Request body is required.');
  try { return JSON.parse(text); } catch { throw new Error('Request body must be valid JSON.'); }
}

function isGenerateRequest(value: unknown): value is AIGenerateRequest {
  if (typeof value !== 'object' || value === null) return false;
  const body = value as Record<string, unknown>;
  if (typeof body.prompt !== 'string' || body.prompt.trim().length < 2 || body.prompt.length > 12000) return false;
  if (body.projectId !== undefined && typeof body.projectId !== 'string') return false;
  if (body.context !== undefined && (typeof body.context !== 'object' || body.context === null)) return false;
  return true;
}

function clientKey(request: IncomingMessage): string {
  const forwarded = request.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length) return forwarded.split(',')[0]?.trim() || 'forwarded';
  return request.socket.remoteAddress ?? 'unknown';
}

export function createApiServer(deps: ApiDependencies): ReturnType<typeof createServer> {
  return createServer(async (request, response) => {
    const requestId = request.headers['x-request-id']?.toString() || randomUUID();
    const origin = request.headers.origin;
    const corsOrigin = deps.config.corsOrigin === '*' ? '*' : origin === deps.config.corsOrigin ? origin : deps.config.corsOrigin;
    const commonHeaders = { 'x-request-id': requestId, 'access-control-allow-origin': corsOrigin, vary: 'Origin' };
    const method = request.method ?? 'GET';
    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? `${deps.config.host}:${deps.config.port}`}`);

    if (method === 'OPTIONS') {
      response.writeHead(204, { ...commonHeaders, 'access-control-allow-methods': 'GET,POST,OPTIONS', 'access-control-allow-headers': 'content-type,authorization,x-request-id' });
      response.end();
      return;
    }

    const limit = deps.limiter.consume(clientKey(request));
    const rateHeaders = { 'x-ratelimit-limit': String(limit.limit), 'x-ratelimit-remaining': String(limit.remaining), 'x-ratelimit-reset': String(Math.ceil(limit.resetAt / 1000)) };
    if (!limit.allowed) { sendJson(response, 429, { error: 'Rate limit exceeded.', requestId }, { ...commonHeaders, ...rateHeaders, 'retry-after': String(Math.max(1, Math.ceil((limit.resetAt - Date.now()) / 1000))) }); return; }

    if (method === 'GET' && url.pathname === '/health') {
      sendJson(response, 200, { service: 'lua-x-api', status: 'ok', version: API_VERSION }, { ...commonHeaders, ...rateHeaders }); return;
    }

    if (method === 'GET' && url.pathname === '/ready') {
      sendJson(response, deps.nvidia.isConfigured() ? 200 : 503, { service: 'lua-x-api', ready: deps.nvidia.isConfigured(), aiProvider: deps.nvidia.isConfigured() ? 'nvidia-configured' : 'not-configured', version: API_VERSION }, { ...commonHeaders, ...rateHeaders }); return;
    }

    if (method === 'GET' && url.pathname === '/api/ai/status') {
      sendJson(response, 200, { provider: 'nvidia', configured: deps.nvidia.isConfigured(), model: deps.config.nvidiaModel }, { ...commonHeaders, ...rateHeaders }); return;
    }

    if (method === 'POST' && url.pathname === '/api/ai/generate') {
      if (!deps.nvidia.isConfigured()) { sendJson(response, 503, { error: 'AI provider is not configured on the backend.', requestId }, { ...commonHeaders, ...rateHeaders }); return; }
      try {
        const payload = await readJson(request);
        if (!isGenerateRequest(payload)) { sendJson(response, 400, { error: 'Invalid AI request. Provide a prompt and optional project context.', requestId }, { ...commonHeaders, ...rateHeaders }); return; }
        const messages = [{ role: 'system' as const, content: buildSystemPrompt() }, { role: 'user' as const, content: buildUserPrompt(payload) }];
        const modelResult = await deps.nvidia.chat(messages);
        const plan = parseAIPlan(modelResult.content);
        sendJson(response, 200, { requestId, provider: 'nvidia', model: modelResult.model ?? deps.config.nvidiaModel, plan, rawTextAvailable: false }, { ...commonHeaders, ...rateHeaders });
      } catch (error) {
        if (error instanceof NvidiaApiError) { const status = error.status >= 400 && error.status < 600 ? error.status : 502; sendJson(response, status, { error: error.message, requestId, retryable: error.retryable }, { ...commonHeaders, ...rateHeaders }); return; }
        const message = error instanceof Error ? error.message : 'AI generation failed.';
        sendJson(response, 502, { error: message, requestId }, { ...commonHeaders, ...rateHeaders });
      }
      return;
    }

    sendJson(response, 404, { error: 'Not found.', requestId }, { ...commonHeaders, ...rateHeaders });
  });
}

if (process.env.NODE_ENV !== 'test') {
  const config = loadConfig();
  const nvidia = new NvidiaClient({
    ...(config.nvidiaApiKey ? { apiKey: config.nvidiaApiKey } : {}),
    baseUrl: config.nvidiaBaseUrl,
    model: config.nvidiaModel,
    maxTokens: config.aiMaxTokens,
    temperature: config.aiTemperature,
    timeoutMs: config.aiTimeoutMs,
  });
  const limiter = new FixedWindowRateLimiter(config.rateLimitWindowMs, config.rateLimitMaxRequests);
  const server = createApiServer({ config, nvidia, limiter });
  server.listen(config.port, config.host, () => console.log(`LUA-X API listening on http://${config.host}:${config.port}`));
  const pruneTimer = setInterval(() => limiter.prune(), Math.max(1000, config.rateLimitWindowMs));
  pruneTimer.unref();
}
