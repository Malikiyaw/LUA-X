import type { AgentRole, ExecutionBrief } from "@lua-x/shared";
import { createChangeSet, type ChangeProposal, type ChangeSet } from "./change-set.js";

export interface PlannedTask {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly agent: AgentRole;
  readonly dependsOn: readonly string[];
  readonly acceptanceCriteria: readonly string[];
  readonly verification: readonly string[];
}

export interface ExecutionPlan {
  readonly goal: string;
  readonly tasks: readonly PlannedTask[];
  readonly changeSet: ChangeSet;
}

function taskId(index: number, role: AgentRole): string {
  return `task_${String(index + 1).padStart(2, "0")}_${role}`;
}

export function decomposeBrief(brief: ExecutionBrief): ExecutionPlan {
  const roles = [...brief.specialistAgents];
  const tasks: PlannedTask[] = roles.map((agent, index) => {
    const id = taskId(index, agent);
    const previous = index === 0 ? [] : [taskId(index - 1, roles[index - 1]!)];
    return {
      id,
      title: `${agent[0]!.toUpperCase()}${agent.slice(1)} task`,
      description: `Handle the ${agent} portion of: ${brief.objective.userIntent}`,
      agent,
      dependsOn: previous,
      acceptanceCriteria: brief.acceptanceCriteria,
      verification: brief.verification,
    };
  });

  const proposals: ChangeProposal[] = tasks.map((task) => ({
    id: task.id,
    operation: "configure",
    target: `planned://${task.agent}`,
    reason: task.description,
    agent: task.agent,
    risk: task.agent === "security" ? "high" : task.agent === "performance" ? "medium" : "low",
    dependsOn: task.dependsOn,
    expectedEffect: "Prepare a reviewable implementation task; no project mutation occurs at planning time.",
    reversible: true,
  }));

  return {
    goal: brief.objective.userIntent,
    tasks,
    changeSet: createChangeSet("LUA-X planned execution", proposals),
  };
}
