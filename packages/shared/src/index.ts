export type AgentRole =
  | "architect"
  | "luau"
  | "animation"
  | "ui"
  | "world"
  | "security"
  | "performance"
  | "playtest"
  | "reviewer";

export type TaskMode = "plan" | "build" | "verify" | "repair";

export interface CreatorRequest {
  readonly prompt: string;
  readonly mode?: TaskMode;
  readonly projectId?: string;
}

export interface ExecutionBrief {
  readonly objective: { readonly summary: string; readonly userIntent: string };
  readonly project: {
    readonly projectId: string | null;
    readonly relevantFiles: readonly string[];
    readonly relevantInstances: readonly string[];
  };
  readonly constraints: {
    readonly mustPreserve: readonly string[];
    readonly security: readonly string[];
    readonly performance: readonly string[];
  };
  readonly acceptanceCriteria: readonly string[];
  readonly verification: readonly string[];
  readonly specialistAgents: readonly AgentRole[];
}

export interface HealthStatus {
  readonly service: "lua-x";
  readonly status: "ok";
  readonly version: string;
}

export const VERSION = "0.2.0";

export function healthStatus(): HealthStatus {
  return { service: "lua-x", status: "ok", version: VERSION };
}

/**
 * Role hierarchy used across the LUA-X platform.
 * @see cloud-core (project membership) and hardening-core (authorization).
 */
export type Role = 'owner' | 'admin' | 'developer' | 'designer' | 'reviewer' | 'viewer';

export const ROLE_RANK: Readonly<Record<Role, number>> = {
  viewer: 0,
  reviewer: 1,
  designer: 2,
  developer: 3,
  admin: 4,
  owner: 5,
};

export function can(role: Role, requiredRole: Role): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[requiredRole];
}

/**
 * Deterministic FNV-1a hash id: stable across processes and builds.
 * @param prefix id prefix (e.g. "chg", "cs") — keeps id namespaces distinct.
 * @param input canonical input string to hash.
 */
export function stableId(prefix: string, input: string): string {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `${prefix}_${(hash >>> 0).toString(16).padStart(8, "0")}`;
}
