import test from 'node:test';
import assert from 'node:assert/strict';
import { server } from './server.js';

async function withServer<T>(run: (baseUrl: string) => Promise<T>): Promise<T> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Test server did not expose a TCP address.');
  try {
    return await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

test('health endpoint reports the current LUA-X web service', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/health`);
    assert.equal(response.status, 200);
    const body = await response.json() as { service: string; status: string; version: string; apiBase: string | null };
    assert.equal(body.service, 'lua-x-web');
    assert.equal(body.status, 'ok');
    assert.equal(body.version, '0.11.0-alpha');
    assert.equal(typeof body.apiBase, 'string');
  });
});

test('canonical Studio plugin is served as LUA-X.lua with download headers', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/download/LUA-X.lua`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'text/plain; charset=utf-8');
    assert.equal(response.headers.get('content-disposition'), 'attachment; filename="LUA-X.lua"');
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    const content = await response.text();
    assert.match(content, /LUA-X Studio Plugin/);
    assert.match(content, /heartbeat/);
    assert.match(content, /LUA_X_STUDIO_SESSION/);
  });
});

test('root plugin path remains a compatible direct download alias', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/LUA-X.lua`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-disposition'), 'attachment; filename="LUA-X.lua"');
  });
});

test('non-API missing routes return 404', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/nonexistent-page`);
    assert.equal(response.status, 404);
  });
});

test('API routes are proxied to the backend API server', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/health`);
    assert.ok(response.status === 200 || response.status === 502);
  });
});
