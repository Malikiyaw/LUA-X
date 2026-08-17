export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
}

interface Bucket { count: number; resetAt: number }

export class FixedWindowRateLimiter {
  private readonly buckets = new Map<string, Bucket>();

  constructor(private readonly windowMs: number, private readonly maxRequests: number) {
    if (windowMs < 1 || maxRequests < 1) throw new Error('Rate limiter settings must be positive.');
  }

  consume(key: string, now = Date.now()): RateLimitResult {
    const current = this.buckets.get(key);
    if (!current || current.resetAt <= now) {
      const next = { count: 1, resetAt: now + this.windowMs };
      this.buckets.set(key, next);
      return { allowed: true, limit: this.maxRequests, remaining: this.maxRequests - 1, resetAt: next.resetAt };
    }
    if (current.count >= this.maxRequests) return { allowed: false, limit: this.maxRequests, remaining: 0, resetAt: current.resetAt };
    current.count += 1;
    return { allowed: true, limit: this.maxRequests, remaining: this.maxRequests - current.count, resetAt: current.resetAt };
  }

  prune(now = Date.now()): void {
    for (const [key, bucket] of this.buckets) if (bucket.resetAt <= now) this.buckets.delete(key);
  }
}
