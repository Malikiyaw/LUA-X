export type Role = 'owner' | 'admin' | 'developer' | 'designer' | 'reviewer' | 'viewer';
export type Risk = 'low' | 'medium' | 'high' | 'critical';
export type MutationKind = 'read' | 'write' | 'delete' | 'execute' | 'publish' | 'secret';
export interface Principal { userId: string; projectId: string; role: Role; authenticated: boolean }
export interface MutationRequest { id: string; kind: MutationKind; risk: Risk; resource: string; destructive: boolean; requiresApproval: boolean }
export interface RateLimit { key: string; limit: number; windowMs: number; used: number; windowStartedAt: number }
export interface RetryPolicy { maxAttempts: number; baseDelayMs: number; maxDelayMs: number }
export interface HealthState { ok: boolean; dependencies: Record<string, 'up' | 'down' | 'degraded'>; checkedAt: string }
export interface AuditRecord { id: string; projectId: string; actorId: string; action: string; success: boolean; requestId: string; at: string }

const rank: Record<Role, number> = { viewer: 0, reviewer: 1, designer: 2, developer: 3, admin: 4, owner: 5 };
const requiredRole: Record<MutationKind, Role> = { read: 'viewer', write: 'developer', delete: 'admin', execute: 'developer', publish: 'admin', secret: 'admin' };
const riskRank: Record<Risk, number> = { low: 0, medium: 1, high: 2, critical: 3 };

export function authorize(p: Principal, request: MutationRequest): { allowed: boolean; reason: string } {
  if (!p.authenticated) return { allowed: false, reason: 'authentication_required' };
  if (!p.projectId || !request.resource) return { allowed: false, reason: 'invalid_context' };
  if (rank[p.role] < rank[requiredRole[request.kind]]) return { allowed: false, reason: 'insufficient_permission' };
  if (request.destructive && riskRank[request.risk] >= riskRank.high && !request.requiresApproval) return { allowed: false, reason: 'approval_required' };
  return { allowed: true, reason: 'authorized' };
}

export function consumeRateLimit(bucket: RateLimit, now = Date.now()): RateLimit & { allowed: boolean } {
  const expired = now - bucket.windowStartedAt >= bucket.windowMs;
  const current = expired ? { ...bucket, used: 0, windowStartedAt: now } : bucket;
  if (current.used >= current.limit) return { ...current, allowed: false };
  return { ...current, used: current.used + 1, allowed: true };
}

export function retryDelay(policy: RetryPolicy, attempt: number): number {
  if (attempt < 1 || attempt > policy.maxAttempts) return 0;
  return Math.min(policy.maxDelayMs, policy.baseDelayMs * 2 ** (attempt - 1));
}

export function validateRetryPolicy(policy: RetryPolicy): void {
  if (!Number.isInteger(policy.maxAttempts) || policy.maxAttempts < 1) throw new Error('maxAttempts must be >= 1.');
  if (!Number.isFinite(policy.baseDelayMs) || policy.baseDelayMs < 0) throw new Error('baseDelayMs must be >= 0.');
  if (!Number.isFinite(policy.maxDelayMs) || policy.maxDelayMs < policy.baseDelayMs) throw new Error('maxDelayMs must be >= baseDelayMs.');
}

export function health(dependencies: Record<string, 'up' | 'down' | 'degraded'>): HealthState {
  const values = Object.values(dependencies);
  return { ok: values.every(v => v === 'up'), dependencies, checkedAt: new Date().toISOString() };
}

export function audit(projectId: string, actorId: string, action: string, success: boolean, requestId: string): AuditRecord {
  return { id: `audit-${crypto.randomUUID()}`, projectId, actorId, action, success, requestId, at: new Date().toISOString() };
}
