import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { generateAIPlan, parseAIPlan, type AIRequest } from '@lua-x/api-core';
import { NvidiaApiError, NvidiaClientPool } from '@lua-x/nvidia-provider';
import { buildSystemPrompt } from './prompt.js';
import { loadConfig } from './config.js';
import { FixedWindowRateLimiter } from './rate-limit.js';
import { studioHandler, appendConversationMessage, loadConversation, storeLastPlan, loadLastPlan, loadApplyResult } from './studio-handler.js';
import { authorized, rateLimitKey } from './auth.js';

export const API_VERSION = '0.11.0-alpha';

const CHAT_SYSTEM_PROMPT = buildSystemPrompt();

export interface ApiDependencies {
  config: ReturnType<typeof loadConfig>;
  nvidia: NvidiaClientPool;
  limiter: FixedWindowRateLimiter;
}

function sendJson(response: ServerResponse, status: number, payload: unknown, headers: Record<string, string> = {}): void {
  response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers });
  response.end(JSON.stringify(payload));
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

function isGenerateRequest(value: unknown): value is AIRequest {
  if (typeof value !== 'object' || value === null) return false;
  const body = value as Record<string, unknown>;
  if (typeof body.prompt !== 'string' || body.prompt.trim().length < 2 || body.prompt.length > 12000) return false;
  if (body.projectId !== undefined && typeof body.projectId !== 'string') return false;
  if (body.mode !== undefined && !['plan', 'build', 'verify', 'repair', 'chat'].includes(String(body.mode))) return false;
  if (body.context !== undefined && (typeof body.context !== 'object' || body.context === null)) return false;
  return true;
}

function toHeaders(request: IncomingMessage): Headers {
  const headers = new Headers();
  for (const [key, value] of Object.entries(request.headers)) {
    if (typeof value === 'string') headers.set(key, value);
    else if (Array.isArray(value)) headers.set(key, value.join(', '));
  }
  return headers;
}

function clientKey(request: IncomingMessage): string {
  return rateLimitKey(toHeaders(request), request.socket.remoteAddress ?? 'unknown');
}

function createDependencies(): ApiDependencies {
  const config = loadConfig();
  let nvidia: NvidiaClientPool;
  if (config.nvidiaApiKeys.length === 0) {
    nvidia = {
      size: 0,
      isConfigured: () => false,
      chat: async () => { throw new NvidiaApiError('AI provider is not configured on the backend.', 503, false); },
    } as unknown as NvidiaClientPool;
  } else {
    nvidia = new NvidiaClientPool({
      apiKeys: config.nvidiaApiKeys,
      baseUrl: config.nvidiaBaseUrl,
      model: config.nvidiaModel,
      maxTokens: config.aiMaxTokens,
      temperature: config.aiTemperature,
      timeoutMs: config.aiTimeoutMs,
    });
  }
  return { config, nvidia, limiter: new FixedWindowRateLimiter(config.rateLimitWindowMs, config.rateLimitMaxRequests) };
}

async function adaptStudioRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  const body = Buffer.concat(chunks);
  const headers = new Headers();
  for (const [key, value] of Object.entries(request.headers)) {
    if (typeof value === 'string') headers.set(key, value);
    else if (Array.isArray(value)) headers.set(key, value.join(', '));
  }
  const target = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
  const fetchRequest = new Request(target, {
    method: request.method ?? 'GET',
    headers,
    ...(request.method === 'POST' || request.method === 'PUT' ? { body: body.length > 0 ? body : null } : {}),
  });
  const fetchResponse = await studioHandler(fetchRequest);
  response.writeHead(fetchResponse.status, Object.fromEntries(fetchResponse.headers.entries()));
  response.end(await fetchResponse.text());
}

export async function handleApiRequest(deps: ApiDependencies, request: IncomingMessage, response: ServerResponse): Promise<void> {
  const requestId = typeof request.headers['x-request-id'] === 'string' && request.headers['x-request-id'].length > 0
    ? request.headers['x-request-id']
    : randomUUID();
  const origin = request.headers.origin;
  const corsOrigin = deps.config.corsOrigin === '*' ? '*' : origin === deps.config.corsOrigin ? origin : deps.config.corsOrigin;
  const commonHeaders = { 'x-request-id': requestId, 'access-control-allow-origin': corsOrigin, vary: 'Origin' };

  try {
    const method = request.method ?? 'GET';
    const url = new URL(request.url ?? '/', `https://${request.headers.host ?? 'vercel.invalid'}`);

    if (method === 'OPTIONS') {
      response.writeHead(204, {
        ...commonHeaders,
        'access-control-allow-methods': 'GET,POST,OPTIONS',
        'access-control-allow-headers': 'content-type,authorization,x-request-id',
      });
      response.end();
      return;
    }

    if (url.pathname.startsWith('/api/studio') || url.pathname.startsWith('/studio/')) {
      await adaptStudioRequest(request, response);
      return;
    }

    const limit = deps.limiter.consume(clientKey(request));
    const rateHeaders = {
      'x-ratelimit-limit': String(limit.limit),
      'x-ratelimit-remaining': String(limit.remaining),
      'x-ratelimit-reset': String(Math.ceil(limit.resetAt / 1000)),
    };
    if (!limit.allowed) {
      sendJson(response, 429, { error: 'Rate limit exceeded.', requestId }, {
        ...commonHeaders,
        ...rateHeaders,
        'retry-after': String(Math.max(1, Math.ceil((limit.resetAt - Date.now()) / 1000))),
      });
      return;
    }

    if (method === 'GET' && (url.pathname === '/' || url.pathname === '/health' || url.pathname === '/api/health')) {
      sendJson(response, 200, {
        service: 'lua-x-api',
        status: 'ok',
        version: API_VERSION,
        aiKeysConfigured: deps.nvidia.size,
      }, { ...commonHeaders, ...rateHeaders });
      return;
    }

    if (method === 'GET' && (url.pathname === '/ready' || url.pathname === '/api/ready')) {
      const configured = deps.nvidia.isConfigured();
      sendJson(response, configured ? 200 : 503, {
        service: 'lua-x-api',
        ready: configured,
        aiProvider: configured ? 'nvidia-configured' : 'not-configured',
        version: API_VERSION,
      }, { ...commonHeaders, ...rateHeaders });
      return;
    }

    if (method === 'GET' && (url.pathname === '/api/ai/status' || url.pathname === '/ai/status')) {
      sendJson(response, 200, {
        provider: 'nvidia',
        configured: deps.nvidia.isConfigured(),
        keyPoolSize: deps.nvidia.size,
        model: deps.config.nvidiaModel,
      }, { ...commonHeaders, ...rateHeaders });
      return;
    }

    if (method === 'POST' && (url.pathname === '/api/ai/generate' || url.pathname === '/ai/generate')) {
      if (!authorized(toHeaders(request))) {
        sendJson(response, 401, { error: 'Unauthorized. Provide a valid LUA-X API token via the Authorization header.', requestId }, {
          ...commonHeaders,
          ...rateHeaders,
        });
        return;
      }

      if (!deps.nvidia.isConfigured()) {
        sendJson(response, 503, { error: 'AI provider is not configured on the backend.', requestId }, {
          ...commonHeaders,
          ...rateHeaders,
        });
        return;
      }

      const payload = await readJson(request);
      if (!isGenerateRequest(payload)) {
        sendJson(response, 400, {
          error: 'Invalid AI request. Provide a prompt and optional project context.',
          requestId,
        }, { ...commonHeaders, ...rateHeaders });
        return;
      }

      try {
        if ((payload as { mode?: string }).mode === 'chat') {
          const requestBody = payload as { prompt: string; context?: unknown; sessionId?: string; history?: unknown };
          const sessionIdRaw = typeof requestBody.sessionId === 'string' ? requestBody.sessionId.trim().slice(0, 100) : '';
          let history: Array<{ role: 'user' | 'assistant'; content: string }> = [];
          if (sessionIdRaw) {
            try {
              const stored = await loadConversation(sessionIdRaw);
              if (stored && Array.isArray(stored.messages) && stored.messages.length > 0) {
                const mapped = stored.messages
                  .map((m) => {
                    if (m.role !== 'user' && m.role !== 'assistant') return null;
                    const prefix = m.surface ? `[${m.surface}] ` : '';
                    return { role: m.role as 'user' | 'assistant', content: `${prefix}${String(m.content).slice(0, 12000)}` };
                  })
                  .filter((v): v is { role: 'user' | 'assistant'; content: string } => v !== null)
                  .slice(-10);
                if (mapped.length > 0) history = mapped;
                else throw new Error('empty');
              } else throw new Error('no stored');
            } catch {
              history = Array.isArray(requestBody.history)
                ? requestBody.history
                    .filter((entry): entry is { role: 'user' | 'assistant'; content: string } =>
                      typeof entry === 'object' && entry !== null
                      && (entry.role === 'user' || entry.role === 'assistant')
                      && typeof entry.content === 'string')
                    .slice(-10)
                : [];
            }
          } else {
            history = Array.isArray(requestBody.history)
              ? requestBody.history
                  .filter((entry): entry is { role: 'user' | 'assistant'; content: string } =>
                    typeof entry === 'object' && entry !== null
                    && (entry.role === 'user' || entry.role === 'assistant')
                    && typeof entry.content === 'string')
                  .slice(-10)
              : [];
          }
          let enrichedExtra = '';
          if (sessionIdRaw) {
            try {
              const last = await loadLastPlan(sessionIdRaw);
              if (last) {
                enrichedExtra += `\n\nLast build plan: ${last.summary} (at ${new Date(last.at).toISOString()})`;
                const p = last.plan as { changes?: { target?: string; operation?: string }[] };
                if (p && Array.isArray(p.changes) && p.changes.length > 0) {
                  const targets = p.changes.slice(0, 6).map(c => `${c.operation}:${c.target}`).join(', ');
                  enrichedExtra += ` Targets: ${targets}${p.changes.length > 6 ? ` (+${p.changes.length - 6} more)` : ''}`;
                }
              }
              const apply = await loadApplyResult(sessionIdRaw);
              if (apply) {
                enrichedExtra += `\nLast Studio apply: ${apply.success} ok / ${apply.failed} failed — ${apply.planSummary}`;
                if (apply.results.length > 0) enrichedExtra += ` | ${apply.results.slice(0, 3).join(' | ')}`;
              }
            } catch { /* ignore */ }
          }
          const baseContextBlock = requestBody.context && typeof requestBody.context === 'object'
            ? `\n\nLive Studio context:\n${JSON.stringify(requestBody.context)}`
            : '';
          const contextBlock = baseContextBlock + enrichedExtra;
          const sessionBlock = typeof requestBody.sessionId === 'string' && requestBody.sessionId
            ? `\nConnected Studio session: ${requestBody.sessionId}`
            : '';
          const chatResult = await deps.nvidia.chat([
            { role: 'system', content: CHAT_SYSTEM_PROMPT },
            ...history,
            { role: 'user', content: requestBody.prompt + sessionBlock + contextBlock },
          ]);
          let plan: unknown;
          try {
            const parsed = parseAIPlan(chatResult.content);
            if (parsed.changes.length > 0) plan = parsed;
          } catch {
            // chat responses are free-form; a plan is optional
          }
          sendJson(response, 200, {
            requestId,
            provider: 'nvidia',
            model: chatResult.model ?? deps.config.nvidiaModel,
            response: chatResult.content,
            ...(plan ? { plan } : {}),
          }, { ...commonHeaders, ...rateHeaders });
          const sessionId = typeof requestBody.sessionId === 'string' ? requestBody.sessionId.trim().slice(0, 100) : '';
          if (sessionId) {
            const surface = typeof (payload as { surface?: string }).surface === 'string'
              && (payload as { surface?: string }).surface === 'plugin' ? 'plugin' : 'web';
            await appendConversationMessage(sessionId, {
              role: 'user',
              content: requestBody.prompt.slice(0, 12000),
              surface,
              at: Date.now(),
            });
            await appendConversationMessage(sessionId, {
              role: 'assistant',
              content: chatResult.content.slice(0, 12000),
              surface: 'server',
              at: Date.now(),
            });
            if (plan) try { await storeLastPlan(sessionId, plan); } catch { /* ignore */ }
          }
          return;
        }
        const generated = await generateAIPlan(payload, deps.nvidia);
        try {
          const sId = typeof (payload as { sessionId?: string }).sessionId === 'string' ? (payload as { sessionId?: string }).sessionId!.trim().slice(0, 100) : '';
          if (sId) {
            const surface = typeof (payload as { surface?: string }).surface === 'string' && (payload as { surface?: string }).surface === 'plugin' ? 'plugin' : 'web';
            await appendConversationMessage(sId, {
              role: 'user',
              content: String((payload as { prompt?: string }).prompt ?? '').slice(0, 12000),
              surface,
              at: Date.now(),
            });
            await appendConversationMessage(sId, {
              role: 'assistant',
              content: `Build plan ready: ${generated.plan.summary.slice(0, 800)} (${generated.plan.changes.length} changes)`,
              surface: 'server',
              at: Date.now(),
            });
            await storeLastPlan(sId, generated.plan);
          }
        } catch { /* best-effort */ }
        sendJson(response, 200, {
          requestId: generated.requestId ?? requestId,
          provider: generated.provider,
          model: generated.model ?? deps.config.nvidiaModel,
          plan: generated.plan,
          pipeline: generated.pipeline,
          rawTextAvailable: false,
        }, { ...commonHeaders, ...rateHeaders });
      } catch (error) {
        const sessionId = typeof (payload as { sessionId?: string }).sessionId === 'string'
          ? (payload as { sessionId?: string }).sessionId!.trim().slice(0, 100)
          : '';
        if (sessionId && (payload as { mode?: string }).mode === 'chat') {
          const surface = typeof (payload as { surface?: string }).surface === 'string'
            && (payload as { surface?: string }).surface === 'plugin' ? 'plugin' : 'web';
          await appendConversationMessage(sessionId, {
            role: 'user',
            content: String((payload as { prompt?: string }).prompt ?? '').trim().slice(0, 12000),
            surface,
            at: Date.now(),
          });
          await appendConversationMessage(sessionId, {
            role: 'assistant',
            content: `Generation failed: ${error instanceof Error ? error.message.slice(0, 12000) : 'Unknown error'}`,
            surface: 'server',
            at: Date.now(),
          });
        }
        if (error instanceof NvidiaApiError) {
          const status = error.status >= 400 && error.status < 600 ? error.status : 502;
          sendJson(response, status, {
            error: error.message,
            requestId,
            retryable: error.retryable,
          }, { ...commonHeaders, ...rateHeaders });
          return;
        }
        throw error;
      }
      return;
    }

    sendJson(response, 404, { error: 'Not found.', requestId }, { ...commonHeaders, ...rateHeaders });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error.';
    if (!response.headersSent) sendJson(response, 500, { error: 'Internal server error.', detail: message, requestId }, commonHeaders);
    else response.destroy(error instanceof Error ? error : undefined);
  }
}

export default async function handler(request: IncomingMessage, response: ServerResponse): Promise<void> {
  await handleApiRequest(createDependencies(), request, response);
}

export function createApiServer(deps: ApiDependencies): ReturnType<typeof createServer> {
  return createServer((request, response) => { void handleApiRequest(deps, request, response); });
}

if (process.env.LUA_X_STANDALONE === 'true' && process.env.NODE_ENV !== 'test') {
  const deps = createDependencies();
  const server = createApiServer(deps);
  server.listen(deps.config.port, deps.config.host, () => console.log(`LUA-X API listening on http://${deps.config.host}:${deps.config.port}`));
  const pruneTimer = setInterval(() => deps.limiter.prune(), Math.max(1000, deps.config.rateLimitWindowMs));
  pruneTimer.unref();
}
