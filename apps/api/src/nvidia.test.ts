import { describe, expect, it } from 'vitest';
import { NvidiaClient, NvidiaApiError } from './nvidia.js';

describe('NvidiaClient', () => {
  it('rejects unconfigured clients', async () => {
    const client = new NvidiaClient({ baseUrl: 'https://example.test/v1', model: 'test', maxTokens: 1, temperature: 0, timeoutMs: 100 });
    await expect(client.chat([{ role: 'user', content: 'hello' }])).rejects.toMatchObject({ status: 503 });
  });

  it('parses an OpenAI-compatible completion', async () => {
    const client = new NvidiaClient({
      apiKey: 'test-key', baseUrl: 'https://example.test/v1', model: 'test', maxTokens: 10, temperature: 0, timeoutMs: 100,
      fetchImpl: async (_input, init) => {
        expect(init?.method).toBe('POST');
        const body = JSON.parse(String(init?.body));
        expect(body.model).toBe('test');
        return new Response(JSON.stringify({ model: 'test', choices: [{ message: { content: 'hello' } }] }), { status: 200, headers: { 'content-type': 'application/json', 'x-request-id': 'req-1' } });
      },
    });
    await expect(client.chat([{ role: 'user', content: 'hello' }])).resolves.toEqual({ content: 'hello', model: 'test', requestId: 'req-1' });
  });

  it('classifies transient failures as retryable', async () => {
    const client = new NvidiaClient({
      apiKey: 'test-key', baseUrl: 'https://example.test/v1', model: 'test', maxTokens: 10, temperature: 0, timeoutMs: 100,
      fetchImpl: async () => new Response('{"error":"busy"}', { status: 429 }),
    });
    await expect(client.chat([{ role: 'user', content: 'hello' }])).rejects.toEqual(expect.objectContaining({ status: 429, retryable: true }));
  });

  it('exports a typed API error', () => expect(new NvidiaApiError('x', 400, false)).toBeInstanceOf(Error));
});
