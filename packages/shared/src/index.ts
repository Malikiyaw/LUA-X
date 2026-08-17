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
  readonly objective: {
    readonly summary: string;
    readonly userIntent: string;
  };
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

export const VERSION = "0.1.0";

export function healthStatus(): HealthStatus {
  return { service: "lua-x", status: "ok", version: VERSION };
}
