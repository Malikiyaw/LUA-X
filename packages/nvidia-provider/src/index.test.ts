import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { NvidiaClient, NvidiaClientPool, NvidiaApiError } from './index.js';

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}

function clientOptions(overrides: Record<string, unknown> = {}) {
  return {
    apiKey: 'test-key',
    baseUrl: 'https://example.com/v1',
    model: 'test-model',
    maxTokens: 1024,
    temperature: 0.2,
    timeoutMs: 1000,
    ...overrides,
  };
}

describe('NvidiaClient', () => {
  it('is configured only when an API key exists', () => {
    assert.equal(new NvidiaClient(clientOptions()).isConfigured(), true);
    assert.equal(new NvidiaClient(clientOptions({ apiKey: undefined })).isConfigured(), false);
  });

  it('throws a non-retryable 503 when no key is configured', async () => {
    const client = new NvidiaClient(clientOptions({ apiKey: undefined }));
    await assert.rejects(
      client.chat([{ role: 'user', content: 'hi' }]),
      (error: unknown) => error instanceof NvidiaApiError && error.status === 503 && error.retryable === false,
    );
  });

  it('throws a 400 for an empty message list', async () => {
    const client = new NvidiaClient(clientOptions());
    await assert.rejects(client.chat([]), (error: unknown) => error instanceof NvidiaApiError && error.status === 400);
  });

  it('sends messages and returns assistant content with model', async () => {
    let sent: unknown;
    const fetchImpl = async (url: string, init: RequestInit) => {
      sent = { url, body: JSON.parse(String(init.body)) };
      return jsonResponse({ model: 'test-model', choices: [{ message: { content: 'hello from model' } }] }, 200, { 'x-request-id': 'req-1' });
    };
    const client = new NvidiaClient(clientOptions({ fetchImpl }));
    const result = await client.chat([{ role: 'user', content: 'hi' }]);
    assert.equal(result.content, 'hello from model');
    assert.equal(result.model, 'test-model');
    assert.equal(result.requestId, 'req-1');
    const sentBody = (sent as { body: { model: string; messages: unknown[]; max_tokens: number; stream: boolean } }).body;
    assert.equal(sentBody.model, 'test-model');
    assert.equal(sentBody.messages.length, 1);
    assert.equal(sentBody.stream, false);
  });

  it('maps HTTP 429 to a retryable error', async () => {
    const fetchImpl = async () => jsonResponse({ error: 'rate limited' }, 429);
    const client = new NvidiaClient(clientOptions({ fetchImpl }));
    await assert.rejects(
      client.chat([{ role: 'user', content: 'hi' }]),
      (error: unknown) => error instanceof NvidiaApiError && error.status === 429 && error.retryable === true,
    );
  });

  it('throws a retryable 502 on empty content', async () => {
    const fetchImpl = async () => jsonResponse({ choices: [{ message: { content: '' } }] }, 200);
    const client = new NvidiaClient(clientOptions({ fetchImpl }));
    await assert.rejects(
      client.chat([{ role: 'user', content: 'hi' }]),
      (error: unknown) => error instanceof NvidiaApiError && error.status === 502 && error.retryable === true,
    );
  });

  it('times out with a 504 when the fetch exceeds the timeout', async () => {
    const fetchImpl = async (_url: string, init: RequestInit) => {
      await new Promise((_, reject) => {
        const signal = init.signal as AbortSignal;
        signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
      });
      return new Response('never');
    };
    const client = new NvidiaClient(clientOptions({ timeoutMs: 50, fetchImpl }));
    await assert.rejects(
      client.chat([{ role: 'user', content: 'hi' }]),
      (error: unknown) => error instanceof NvidiaApiError && error.status === 504 && /timed out/i.test(error.message),
    );
  });
});

describe('NvidiaClientPool', () => {
  it('requires at least one key', () => {
    assert.throws(() => new NvidiaClientPool({ ...clientOptions(), apiKeys: [] }), /At least one NVIDIA API key/);
  });

  it('deduplicates keys and reports size', () => {
    const pool = new NvidiaClientPool({ ...clientOptions(), apiKeys: ['a', 'a', 'b'] });
    assert.equal(pool.size, 2);
    assert.equal(pool.isConfigured(), true);
  });

  it('fails over to the next key on a retryable error', async () => {
    const calls: string[] = [];
    const fetchImpl = async (_url: string, init: RequestInit) => {
      const headers = init.headers as Record<string, string>;
      const key = String(headers.authorization || '').replace('Bearer ', '');
      calls.push(key);
      const body = JSON.parse(String(init.body)) as { messages: Array<{ role: string; content: string }> };
      if (key === 'key-1' && body.messages[0]?.content === 'boom') return jsonResponse({ error: 'overloaded' }, 503);
      return jsonResponse({ choices: [{ message: { content: 'ok' } }] });
    };
    const pool = new NvidiaClientPool({ ...clientOptions({ fetchImpl }), apiKeys: ['key-1', 'key-2'] });
    const result = await pool.chat([{ role: 'user', content: 'boom' }]);
    assert.equal(result.content, 'ok');
    assert.deepEqual(calls, ['key-1', 'key-2']);
  });

  it('rethrows immediately when a single-key pool fails', async () => {
    const fetchImpl = async () => jsonResponse({ error: 'boom' }, 503);
    const pool = new NvidiaClientPool({ ...clientOptions({ fetchImpl }), apiKeys: ['only'] });
    await assert.rejects(pool.chat([{ role: 'user', content: 'hi' }]), (error: unknown) => error instanceof NvidiaApiError && error.status === 503);
  });

  it('throws after exhausting all keys', async () => {
    const fetchImpl = async () => jsonResponse({ error: 'boom' }, 503);
    const pool = new NvidiaClientPool({ ...clientOptions({ fetchImpl }), apiKeys: ['a', 'b', 'c'] });
    await assert.rejects(pool.chat([{ role: 'user', content: 'hi' }]), (error: unknown) => error instanceof NvidiaApiError);
  });

  it('surfaces non-retryable errors without failing over', async () => {
    const calls: string[] = [];
    const fetchImpl = async (_url: string, init: RequestInit) => {
      calls.push(String(init.body));
      return jsonResponse({ error: 'invalid key' }, 401);
    };
    const pool = new NvidiaClientPool({ ...clientOptions({ fetchImpl }), apiKeys: ['a', 'b'] });
    await assert.rejects(pool.chat([{ role: 'user', content: 'hi' }]), (error: unknown) => error instanceof NvidiaApiError && error.status === 401);
    assert.equal(calls.length, 1);
  });
});