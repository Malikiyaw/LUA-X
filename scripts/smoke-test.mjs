#!/usr/bin/env node
// Production smoke tests for the LUA-X deployed API.
// Usage: node scripts/smoke-test.mjs [baseUrl]
// Default baseUrl: https://lua-x-api.vercel.app

const base = (process.argv[2] || process.env.LUA_X_SMOKE_URL || 'https://lua-x-api.vercel.app').replace(/\/$/, '');
const timeoutMs = 20000;

async function check(name, fn) {
  const t0 = Date.now();
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const result = await fn(ac.signal);
    const ms = Date.now() - t0;
    console.log(`${result.ok ? 'PASS' : 'FAIL'}  ${name}  (${ms}ms)${result.detail ? `  ${result.detail}` : ''}`);
    return result.ok;
  } catch (error) {
    console.log(`FAIL  ${name}  (${Date.now() - t0}ms)  ${error instanceof Error ? error.message : String(error)}`);
    return false;
  } finally {
    clearTimeout(timer);
  }
}

const results = await Promise.all([
  check('GET  /api/health', async signal => {
    const r = await fetch(`${base}/api/health`, { signal });
    const b = await r.json().catch(() => ({}));
    return { ok: r.status === 200 && b.status === 'ok', detail: `HTTP ${r.status}` };
  }),
  check('GET  /api/studio/ping', async signal => {
    const r = await fetch(`${base}/api/studio/ping`, { signal });
    const b = await r.json().catch(() => ({}));
    return { ok: r.status === 200 && b.ok === true, detail: `HTTP ${r.status}` };
  }),
  check('GET  /api/studio/status', async signal => {
    const r = await fetch(`${base}/api/studio/status`, { signal });
    return { ok: r.status === 200, detail: `HTTP ${r.status}` };
  }),
  check('POST /api/studio/connect', async signal => {
    const r = await fetch(`${base}/api/studio/connect`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectId: 'smoke-test' }),
      signal,
    });
    const b = await r.json().catch(() => ({}));
    const ok = r.status === 200 && typeof b.requestId === 'string' && b.status === 'waiting' && b.expiresIn === 30;
    return { ok, detail: ok ? `requestId=${b.requestId}` : `HTTP ${r.status}` };
  }),
  check('GET  /api/studio/diagnostics', async signal => {
    const r = await fetch(`${base}/api/studio/diagnostics`, { signal });
    const b = await r.json().catch(() => ({}));
    return { ok: r.status === 200 && b.handler === 'loaded', detail: `HTTP ${r.status} redis=${b.redisConfigured ? 'configured' : 'not-configured'}` };
  }),
]);

const passed = results.filter(Boolean).length;
console.log(`\n${passed} of ${results.length} smoke checks passed.`);
if (passed < results.length) {
  console.log('Deployment is NOT healthy — inspect the failing functions in Vercel logs before testing Roblox Studio.');
  process.exit(1);
}
console.log('Deployment healthy. Proceed to the Roblox Studio handshake test.');