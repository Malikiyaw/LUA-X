import { describe, expect, it } from 'vitest';
import { authorize, consumeRateLimit, health, retryDelay, validateRetryPolicy } from './index.js';

describe('hardening core', () => {
  const principal = { userId: 'u1', projectId: 'p1', role: 'developer' as const, authenticated: true };
  it('denies unauthenticated mutations', () => expect(authorize({ ...principal, authenticated: false }, { id:'1', kind:'write', risk:'low', resource:'code', destructive:false, requiresApproval:false }).allowed).toBe(false));
  it('requires elevated permission for publish and approval for risky destructive actions', () => {
    expect(authorize(principal, { id:'1', kind:'publish', risk:'high', resource:'place', destructive:true, requiresApproval:true }).allowed).toBe(false);
    expect(authorize({ ...principal, role:'admin' }, { id:'1', kind:'publish', risk:'high', resource:'place', destructive:true, requiresApproval:false }).allowed).toBe(false);
  });
  it('enforces a fixed-window rate limit', () => {
    const b = { key:'u1', limit:2, windowMs:1000, used:1, windowStartedAt:100 };
    expect(consumeRateLimit(b, 500).allowed).toBe(true);
    expect(consumeRateLimit({ ...b, used:2 }, 500).allowed).toBe(false);
    expect(consumeRateLimit({ ...b, used:2 }, 1200).allowed).toBe(true);
  });
  it('caps exponential retry delay', () => expect(retryDelay({maxAttempts:4, baseDelayMs:100, maxDelayMs:250}, 4)).toBe(250));
  it('validates retry policy and health', () => { expect(() => validateRetryPolicy({maxAttempts:0,baseDelayMs:1,maxDelayMs:1})).toThrow(); expect(health({db:'up', studio:'degraded'}).ok).toBe(false); });
});
