import { createHash } from 'node:crypto';

/**
 * Self-contained auth helpers for the Vercel functions in api/.
 * Vercel functions cannot import across monorepo workspaces, so this module
 * is duplicated from apps/api/src/auth.ts by design (see scripts/sync-*.mjs
 * for the same pattern). Keep both copies in sync.
 */

function apiToken(): string {
  return process.env.LUA_X_API_TOKEN?.trim() ?? '';
}

export function tokenConfigured(): boolean {
  return apiToken().length > 0;
}

function trustProxy(): boolean {
  const value = process.env.LUA_X_TRUST_PROXY?.trim().toLowerCase();
  if (value === '1' || value === 'true' || value === 'yes') return true;
  if (value === '0' || value === 'false' || value === 'no') return false;
  // Vercel functions always sit behind the Vercel edge, so trust by default.
  return true;
}

function headerValue(headers: Headers, name: string): string | null {
  return headers.get(name);
}

function bearerToken(headers: Headers): string | null {
  const value = headerValue(headers, 'authorization');
  if (!value) return null;
  const match = /^Bearer\s+(.+)$/i.exec(value.trim());
  return match ? match[1]!.trim() : null;
}

/**
 * Constant-time comparison of the provided bearer token against LUA_X_API_TOKEN.
 * When no token is configured, requests are allowed (auth disabled).
 */
export function authorized(headers: Headers): boolean {
  const expected = apiToken();
  if (!expected) return true;
  const provided = bearerToken(headers);
  if (!provided) return false;
  if (provided.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < provided.length; i += 1) diff |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

/**
 * Client IP for rate limiting. When trusting the proxy, the LAST
 * x-forwarded-for entry is used because each trusted proxy appends the
 * address it observed — the first entry is client-supplied and forgeable.
 */
export function clientIp(headers: Headers): string {
  if (trustProxy()) {
    const forwarded = headerValue(headers, 'x-forwarded-for');
    if (forwarded) {
      const parts = forwarded.split(',').map((part) => part.trim()).filter(Boolean);
      if (parts.length > 0) return parts[parts.length - 1]!;
    }
    const real = headerValue(headers, 'x-real-ip');
    if (real) return real;
  }
  return '';
}

/**
 * Rate-limit key: the authenticated token identity when present (stable per
 * token, not forgeable), otherwise the trusted client IP, otherwise the
 * caller-provided fallback.
 */
export function rateLimitKey(headers: Headers, fallback: string): string {
  const expected = apiToken();
  const provided = bearerToken(headers);
  if (expected && provided && provided.length === expected.length) {
    return `token:${createHash('sha256').update(provided).digest('hex').slice(0, 16)}`;
  }
  const ip = clientIp(headers);
  return ip ? `ip:${ip}` : fallback;
}