import { describe, expect, it } from 'vitest';
import { FixedWindowRateLimiter } from './rate-limit.js';

describe('FixedWindowRateLimiter', () => {
  it('allows up to the configured limit', () => {
    const limiter = new FixedWindowRateLimiter(1000, 2);
    expect(limiter.consume('a', 0).allowed).toBe(true);
    expect(limiter.consume('a', 1).remaining).toBe(0);
    expect(limiter.consume('a', 2).allowed).toBe(false);
  });
  it('resets after the window', () => {
    const limiter = new FixedWindowRateLimiter(1000, 1);
    expect(limiter.consume('a', 0).allowed).toBe(true);
    expect(limiter.consume('a', 999).allowed).toBe(false);
    expect(limiter.consume('a', 1000).allowed).toBe(true);
  });
});
