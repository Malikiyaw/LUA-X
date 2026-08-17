import { describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import { createApiServer, type ApiDependencies } from './server.js';
import { NvidiaClientPool } from './nvidia-pool.js';
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

  it('rejects invalid generate payloads', async () => withServer(async url => {
    const response = await fetch(`${url}/api/ai/generate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt: '' }) });
    expect(response.status).toBe(400);
  }));
});
