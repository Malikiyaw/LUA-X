import type { ExecutionBrief } from "@lua-x/shared";
import type { ProjectMemoryEntry } from "./memory.js";
import type { ExecutionPlan } from "./planner.js";

export interface CompiledPrompt {
  readonly system: string;
  readonly context: string;
  readonly task: string;
  readonly acceptance: string;
  readonly verification: string;
  readonly metadata: {
    readonly version: "2.0";
    readonly estimatedContextSections: number;
  };
}

const SYSTEM_RULES = [
  "You are LUA-X, a Roblox-native engineering orchestrator.",
  "Build the smallest correct solution that fits the existing project.",
  "Do not invent Roblox APIs, project facts, asset IDs, test results, or tool results.",
  "Treat client-originated gameplay data as untrusted and preserve server authority.",
  "Prefer targeted changes over unrelated rewrites.",
  "Separate known facts, inferred facts, proposed changes, and verified results.",
];

export function compileModelPrompt(
  brief: ExecutionBrief,
  plan: ExecutionPlan,
  memory: readonly ProjectMemoryEntry[] = [],
): CompiledPrompt {
  const context = [
    `Project ID: ${brief.project.projectId ?? "unknown"}`,
    `Relevant files: ${brief.project.relevantFiles.join(", ") || "none retrieved"}`,
    `Relevant instances: ${brief.project.relevantInstances.join(", ") || "none retrieved"}`,
    `Specialists: ${brief.specialistAgents.join(", ")}`,
    memory.length
      ? `Project memory:\n${memory.map((entry) => `- [${entry.kind}] ${entry.content}`).join("\n")}`
      : "Project memory: none available.",
  ].join("\n");

  const tasks = plan.tasks
    .map((task) => `- ${task.id}: ${task.description} [agent=${task.agent}; depends=${task.dependsOn.join(",") || "none"}]`)
    .join("\n");

  return {
    system: SYSTEM_RULES.join("\n"),
    context,
    task: `Creator intent:\n${brief.objective.userIntent}\n\nExecution plan:\n${tasks}`,
    acceptance: brief.acceptanceCriteria.map((item) => `- ${item}`).join("\n"),
    verification: brief.verification.map((item) => `- ${item}`).join("\n"),
    metadata: { version: "2.0", estimatedContextSections: 5 },
  };
}
