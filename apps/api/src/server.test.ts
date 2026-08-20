import { describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import { createApiServer, type ApiDependencies } from './server.js';
import { NvidiaClientPool, NvidiaApiError } from '@lua-x/nvidia-provider';
import { FixedWindowRateLimiter } from './rate-limit.js';

function deps(): ApiDependencies {
  const config = {
    host: '127.0.0.1', port: 0, nodeEnv: 'test',
    nvidiaApiKeys: ['test-key-1', 'test-key-2'], nvidiaBaseUrl: 'https://example.test/v1', nvidiaModel: 'test-model',
    aiMaxTokens: 128, aiTemperature: 0.2, aiTimeoutMs: 1000,
    rateLimitWindowMs: 60_000, rateLimitMaxRequests: 20, corsOrigin: '*',
  };
  const nvidia = new NvidiaClientPool({
    apiKeys: config.nvidiaApiKeys,
    baseUrl: config.nvidiaBaseUrl,
    model: config.nvidiaModel,
    maxTokens: config.aiMaxTokens,
    temperature: config.aiTemperature,
    timeoutMs: config.aiTimeoutMs,
    fetchImpl: async () => new Response(JSON.stringify({ model: 'test-model', choices: [{ message: { content: JSON.stringify({ summary: 'Build a test feature', assumptions: [], changes: [], acceptanceCriteria: ['works'], verification: ['test it'], risks: [] }) } }] }), { status: 200, headers: { 'content-type': 'application/json' } }),
  });
  return { config, nvidia, limiter: new FixedWindowRateLimiter(config.rateLimitWindowMs, config.rateLimitMaxRequests) };
}

async function withServer(run: (url: string) => Promise<void>): Promise<void> {
  const server = createApiServer(deps());
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => resolve()); });
  try {
    const address = server.address() as AddressInfo;
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
}

describe('API server', () => {
  it('reports health and AI readiness', async () => withServer(async url => {
    const health = await fetch(`${url}/health`);
    expect(health.status).toBe(200);
    const healthBody = await health.json();
    expect(healthBody.status).toBe('ok');
    expect(healthBody.aiKeysConfigured).toBe(2);
    const ready = await fetch(`${url}/ready`);
    expect(ready.status).toBe(200);
    expect((await ready.json()).ready).toBe(true);
  }));

  it('generates a validated AI plan through the multi-key provider pool', async () => withServer(async url => {
    const response = await fetch(`${url}/api/ai/generate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt: 'Build a test feature', projectId: 'demo' }) });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.provider).toBe('nvidia');
    expect(body.plan.summary).toBe('Build a test feature');
  }));

  it('returns a structured plan when mode is build', async () => withServer(async url => {
    const response = await fetch(`${url}/api/ai/generate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt: 'Add a sprint system with a sound', projectId: 'demo', mode: 'build' }) });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.plan).toBeDefined();
    expect(body.plan.summary).toBe('Build a test feature');
    expect(Array.isArray(body.plan.changes)).toBe(true);
    expect(body.rawTextAvailable).toBe(false);
  }));

  it('returns plain chat text when mode is chat', async () => withServer(async url => {
    const config = {
      host: '127.0.0.1', port: 0, nodeEnv: 'test',
      nvidiaApiKeys: ['test-key-1'], nvidiaBaseUrl: 'https://example.test/v1', nvidiaModel: 'test-model',
      aiMaxTokens: 128, aiTemperature: 0.2, aiTimeoutMs: 1000,
      rateLimitWindowMs: 60_000, rateLimitMaxRequests: 20, corsOrigin: '*',
    };
    const nvidia = new NvidiaClientPool({
      apiKeys: config.nvidiaApiKeys,
      baseUrl: config.nvidiaBaseUrl,
      model: config.nvidiaModel,
      maxTokens: config.aiMaxTokens,
      temperature: config.aiTemperature,
      timeoutMs: config.aiTimeoutMs,
      fetchImpl: async () => new Response(JSON.stringify({ model: 'test-model', choices: [{ message: { content: 'Use a LocalScript for client input.' } }] }), { status: 200, headers: { 'content-type': 'application/json' } }),
    });
    const server = createApiServer({ config, nvidia, limiter: new FixedWindowRateLimiter(config.rateLimitWindowMs, config.rateLimitMaxRequests) });
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => resolve()); });
    try {
      const address = server.address() as AddressInfo;
      const url = `http://127.0.0.1:${address.port}`;
      const response = await fetch(`${url}/api/ai/generate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt: 'Explain sprint systems', mode: 'chat' }) });
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.response).toBe('Use a LocalScript for client input.');
      expect(body.plan).toBeUndefined();
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  }));

  it('rejects invalid generate payloads', async () => withServer(async url => {
    const response = await fetch(`${url}/api/ai/generate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt: '' }) });
    expect(response.status).toBe(400);
  }));

  it('shares chat messages across web and plugin through the studio conversation', async () => withServer(async url => {
    const empty = await fetch(`${url}/api/studio/chat?sessionId=session-shared`);
    expect(empty.status).toBe(200);
    expect((await empty.json()).messages).toEqual([]);

    const config = {
      host: '127.0.0.1', port: 0, nodeEnv: 'test',
      nvidiaApiKeys: ['test-key-1'], nvidiaBaseUrl: 'https://example.test/v1', nvidiaModel: 'test-model',
      aiMaxTokens: 128, aiTemperature: 0.2, aiTimeoutMs: 1000,
      rateLimitWindowMs: 60_000, rateLimitMaxRequests: 20, corsOrigin: '*',
    };
    const nvidia = new NvidiaClientPool({
      apiKeys: config.nvidiaApiKeys,
      baseUrl: config.nvidiaBaseUrl,
      model: config.nvidiaModel,
      maxTokens: config.aiMaxTokens,
      temperature: config.aiTemperature,
      timeoutMs: config.aiTimeoutMs,
      fetchImpl: async () => new Response(JSON.stringify({ model: 'test-model', choices: [{ message: { content: 'Use a LocalScript for client input.' } }] }), { status: 200, headers: { 'content-type': 'application/json' } }),
    });
    const server = createApiServer({ config, nvidia, limiter: new FixedWindowRateLimiter(config.rateLimitWindowMs, config.rateLimitMaxRequests) });
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => resolve()); });
    try {
      const address = server.address() as AddressInfo;
      const host = `http://127.0.0.1:${address.port}`;
      const response = await fetch(`${host}/api/ai/generate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt: 'Explain sprint systems', mode: 'chat', sessionId: 'session-shared', surface: 'plugin' }) });
      expect(response.status).toBe(200);

      const conversation = await fetch(`${host}/api/studio/chat?sessionId=session-shared`);
      expect(conversation.status).toBe(200);
      const body = await conversation.json();
      expect(body.messages.length).toBe(2);
      expect(body.messages[0].role).toBe('user');
      expect(body.messages[0].surface).toBe('plugin');
      expect(body.messages[1].role).toBe('assistant');
      expect(body.messages[1].surface).toBe('server');
      expect(body.messages[1].content).toBe('Use a LocalScript for client input.');

      const posted = await fetch(`${host}/api/studio/chat`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId: 'session-shared', role: 'user', content: 'Hi from the web', surface: 'web' }) });
      expect(posted.status).toBe(200);
      expect((await posted.json()).count).toBe(3);

      const after = await fetch(`${host}/api/studio/chat?sessionId=session-shared`);
      const afterBody = await after.json();
      expect(afterBody.messages[2].surface).toBe('web');
      expect(afterBody.messages[2].content).toBe('Hi from the web');
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  }));

  it('runs the full Studio connect handshake (connect → pending → register → status)', async () => withServer(async url => {
    const connect = await fetch(`${url}/api/studio/connect`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ projectId: 'web' }) });
    expect(connect.status).toBe(200);
    const connectBody = await connect.json();
    expect(connectBody.status).toBe('waiting');
    expect(connectBody.expiresIn).toBe(60);
    expect(connectBody.requestId).toMatch(/^connect_/);

    const pending = await fetch(`${url}/api/studio/connect/pending`);
    expect(pending.status).toBe(200);
    const pendingBody = await pending.json();
    expect(pendingBody.request).not.toBeNull();
    expect(pendingBody.request.requestId).toBe(connectBody.requestId);
    expect(pendingBody.request.projectId).toBe('web');

    const register = await fetch(`${url}/api/studio/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        projectId: 'demo',
        sessionId: 'session-handshake',
        pluginVersion: '1.4.0',
        requestId: connectBody.requestId,
      }),
    });
    expect(register.status).toBe(200);
    const registerBody = await register.json();
    expect(registerBody.connected).toBe(true);
    expect(registerBody.requestStatus).toBe('fulfilled');
    expect(registerBody.sessionId).toBe('session-handshake');

    const status = await fetch(`${url}/api/studio/connect/status?requestId=${connectBody.requestId}`);
    expect(status.status).toBe(200);
    const statusBody = await status.json();
    expect(statusBody.status).toBe('fulfilled');
    expect(statusBody.sessionId).toBe('session-handshake');

    const presence = await fetch(`${url}/api/studio/status`);
    const presenceBody = await presence.json();
    expect(presenceBody.connected).toBe(true);
    expect(presenceBody.sessionId).toBe('session-handshake');

    const again = await fetch(`${url}/api/studio/connect/pending`);
    expect((await again.json()).request).toBeNull();
  }));

  it('returns an expired status for an unknown connect request', async () => withServer(async url => {
    const status = await fetch(`${url}/api/studio/connect/status?requestId=connect_does-not-exist`);
    expect(status.status).toBe(200);
    expect((await status.json()).status).toBe('expired');
  }));

  it('reports studio diagnostics with all routes available', async () => withServer(async url => {
    const response = await fetch(`${url}/api/studio/diagnostics`);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.service).toBe('studio');
    expect(body.runtime).toBe('nodejs');
    expect(body.handler).toBe('loaded');
    expect(body.api).toBe('ok');
    expect(body.connectRoute).toBe('ok');
    expect(body.statusRoute).toBe('ok');
    expect(body.registerRoute).toBe('ok');
    expect(body.heartbeatRoute).toBe('ok');
    expect(body.commandRoute).toBe('ok');
    expect(body.chatRoute).toBe('ok');
    expect(body.contextRoute).toBe('ok');
    expect(body.redisConfigured).toBe(false);
    expect(body.redisReachable).toBe(false);
  }));

  it('exposes a minimal studio ping without any dependencies', async () => withServer(async url => {
    const response = await fetch(`${url}/api/studio/ping`);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(body.service).toBe('studio');
    expect(body.runtime).toBe('nodejs');
  }));

  it('creates a connection request for a minimal valid payload', async () => withServer(async url => {
    const response = await fetch(`${url}/api/studio/connect`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ projectId: 'web' }) });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.status).toBe('waiting');
    expect(body.expiresIn).toBe(60);
    expect(typeof body.requestId).toBe('string');
    expect(body.requestId.startsWith('connect_')).toBe(true);
  }));

  it('never crashes the connect endpoint on bad input', async () => withServer(async url => {
    const post = (body: string | null) => fetch(`${url}/api/studio/connect`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      ...(body === null ? {} : { body }),
    });
    const emptyProject = await post(JSON.stringify({ projectId: '' }));
    expect(emptyProject.status).toBe(200);
    expect((await emptyProject.json()).requestId).toBeTruthy();
    const emptyObject = await post('{}');
    expect(emptyObject.status).toBe(200);
    expect((await emptyObject.json()).requestId).toBeTruthy();
    const malformed = await post('{not json');
    expect(malformed.status).toBe(400);
    const missingBody = await post(null);
    expect(missingBody.status).toBe(400);
  }));

  it('stays online with zero NVIDIA keys configured (health + studio still work)', async () => {
    const config = {
      host: '127.0.0.1', port: 0, nodeEnv: 'test',
      nvidiaApiKeys: [] as string[], nvidiaBaseUrl: 'https://example.test/v1', nvidiaModel: 'test-model',
      aiMaxTokens: 128, aiTemperature: 0.2, aiTimeoutMs: 1000,
      rateLimitWindowMs: 60_000, rateLimitMaxRequests: 20, corsOrigin: '*',
    };
    const nvidia = {
      size: 0,
      isConfigured: () => false,
      chat: async () => { throw new NvidiaApiError('AI provider is not configured on the backend.', 503, false); },
    } as unknown as NvidiaClientPool;
    const server = createApiServer({ config, nvidia, limiter: new FixedWindowRateLimiter(config.rateLimitWindowMs, config.rateLimitMaxRequests) });
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => resolve()); });
    try {
      const address = server.address() as AddressInfo;
      const url = `http://127.0.0.1:${address.port}`;
      const health = await fetch(`${url}/api/health`);
      expect(health.status).toBe(200);
      expect((await health.json()).aiKeysConfigured).toBe(0);
      const ready = await fetch(`${url}/ready`);
      expect(ready.status).toBe(503);
      const ping = await fetch(`${url}/api/studio/ping`);
      expect(ping.status).toBe(200);
      const connect = await fetch(`${url}/api/studio/connect`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ projectId: 'web' }) });
      expect(connect.status).toBe(200);
      expect((await connect.json()).requestId).toMatch(/^connect_/);
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });
});
