import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { authorized, rateLimitKey, clientIp, tokenConfigured } from './auth.js';

const ENV_KEYS = ['LUA_X_API_TOKEN', 'LUA_X_TRUST_PROXY'];

function setEnv(entries: Record<string, string | undefined>) {
  for (const [key, value] of Object.entries(entries)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function headers(init: Record<string, string> = {}): Headers {
  const h = new Headers();
  for (const [key, value] of Object.entries(init)) h.set(key, value);
  return h;
}

describe('auth.authorized', () => {
  beforeEach(() => setEnv({ LUA_X_API_TOKEN: undefined, LUA_X_TRUST_PROXY: undefined }));
  afterEach(() => setEnv({ LUA_X_API_TOKEN: undefined, LUA_X_TRUST_PROXY: undefined }));

  it('allows all requests when no token is configured', () => {
    expect(tokenConfigured()).toBe(false);
    expect(authorized(headers())).toBe(true);
    expect(authorized(headers({ authorization: 'Bearer whatever' }))).toBe(true);
  });

  it('rejects missing or malformed tokens when configured', () => {
    setEnv({ LUA_X_API_TOKEN: 'secret-token' });
    expect(authorized(headers())).toBe(false);
    expect(authorized(headers({ authorization: 'Basic abc' }))).toBe(false);
    expect(authorized(headers({ authorization: 'Bearer wrong-token' }))).toBe(false);
  });

  it('accepts the exact bearer token (constant-time compare)', () => {
    setEnv({ LUA_X_API_TOKEN: 'secret-token' });
    expect(authorized(headers({ authorization: 'Bearer secret-token' }))).toBe(true);
    expect(authorized(headers({ authorization: 'bearer secret-token' }))).toBe(true);
  });
});

describe('auth.clientIp', () => {
  beforeEach(() => setEnv({ LUA_X_API_TOKEN: undefined, LUA_X_TRUST_PROXY: undefined }));
  afterEach(() => setEnv({ LUA_X_API_TOKEN: undefined, LUA_X_TRUST_PROXY: undefined }));

  it('ignores forwarded headers when the proxy is not trusted', () => {
    expect(clientIp(headers({ 'x-forwarded-for': '1.2.3.4, 5.6.7.8', 'x-real-ip': '9.9.9.9' }))).toBe('');
  });

  it('uses the LAST x-forwarded-for hop when trusting the proxy', () => {
    setEnv({ LUA_X_TRUST_PROXY: 'true' });
    expect(clientIp(headers({ 'x-forwarded-for': '1.2.3.4, 5.6.7.8' }))).toBe('5.6.7.8');
    expect(clientIp(headers({ 'x-forwarded-for': 'forged' }))).toBe('forged');
  });

  it('falls back to x-real-ip when trusting the proxy and x-forwarded-for is absent', () => {
    setEnv({ LUA_X_TRUST_PROXY: 'true' });
    expect(clientIp(headers({ 'x-real-ip': '10.0.0.1' }))).toBe('10.0.0.1');
  });
});

describe('auth.rateLimitKey', () => {
  beforeEach(() => setEnv({ LUA_X_API_TOKEN: undefined, LUA_X_TRUST_PROXY: undefined }));
  afterEach(() => setEnv({ LUA_X_API_TOKEN: undefined, LUA_X_TRUST_PROXY: undefined }));

  it('keys on the token identity when authenticated (not forgeable)', () => {
    setEnv({ LUA_X_API_TOKEN: 'secret-token' });
    const withToken = rateLimitKey(headers({ authorization: 'Bearer secret-token' }), 'fallback');
    expect(withToken.startsWith('token:')).toBe(true);
    expect(withToken).toBe(rateLimitKey(headers({ authorization: 'Bearer secret-token' }), 'fallback'));
    expect(rateLimitKey(headers({ authorization: 'Bearer forged' }), 'fallback')).toBe('fallback');
  });

  it('uses the trusted IP when unauthenticated and the proxy is trusted', () => {
    setEnv({ LUA_X_TRUST_PROXY: 'true' });
    expect(rateLimitKey(headers({ 'x-forwarded-for': 'a, b' }), 'fallback')).toBe('ip:b');
  });

  it('uses the fallback when nothing can be trusted', () => {
    expect(rateLimitKey(headers({ 'x-forwarded-for': 'forged' }), 'socket-addr')).toBe('socket-addr');
  });
});