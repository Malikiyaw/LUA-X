import type { AgentRole, CreatorRequest, ExecutionBrief, TaskMode } from "@lua-x/shared";

const ROLE_KEYWORDS: readonly [AgentRole, readonly string[]][] = [
  ["animation", ["animation", "animate", "keyframe", "emote", "sword swing", "motion"]],
  ["ui", ["ui", "interface", "menu", "button", "hud", "screen"]],
  ["world", ["map", "world", "environment", "building", "terrain", "scene"]],
  ["security", ["secure", "security", "exploit", "remoteevent", "permission", "validate"]],
  ["performance", ["performance", "optimize", "lag", "memory", "fps", "latency"]],
  ["playtest", ["test", "playtest", "verify", "regression", "bug"]],
  ["luau", ["luau", "script", "module", "function", "remote", "datastore", "code"]],
];

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

function inferMode(request: CreatorRequest): TaskMode {
  if (request.mode) return request.mode;
  const prompt = normalize(request.prompt);
  if (/\b(test|verify|check|debug|fix bug)\b/.test(prompt)) return "verify";
  if (/\b(plan|architect|design)\b/.test(prompt)) return "plan";
  return "build";
}

function inferAgents(prompt: string): AgentRole[] {
  const normalized = normalize(prompt);
  const agents = new Set<AgentRole>(["architect", "reviewer"]);

  for (const [role, keywords] of ROLE_KEYWORDS) {
    if (keywords.some((keyword) => normalized.includes(keyword))) agents.add(role);
  }

  if (agents.has("security") || agents.has("performance")) agents.add("playtest");
  return [...agents];
}

export function compileExecutionBrief(request: CreatorRequest): ExecutionBrief {
  const prompt = request.prompt.trim();
  if (!prompt) throw new Error("Creator prompt cannot be empty.");

  const mode = inferMode(request);
  const agents = inferAgents(prompt);
  const projectId = request.projectId ?? null;

  return {
    objective: {
      summary: prompt.length > 140 ? `${prompt.slice(0, 137)}...` : prompt,
      userIntent: prompt,
    },
    project: {
      projectId,
      relevantFiles: [],
      relevantInstances: [],
    },
    constraints: {
      mustPreserve: ["Preserve unrelated working behavior."],
      security: ["Treat client-originated gameplay data as untrusted."],
      performance: ["Avoid unnecessary per-frame work and remote traffic."],
    },
    acceptanceCriteria: [
      `Implement the requested change in ${mode} mode.`,
      "Match the existing project architecture and conventions.",
      "Produce a reviewable change set.",
    ],
    verification: [
      "Run available static/type checks.",
      "Run relevant automated tests.",
      "Report environment-dependent checks as unverified rather than claiming success.",
    ],
    specialistAgents: agents,
  };
}

export function routeRequest(request: CreatorRequest): { mode: TaskMode; brief: ExecutionBrief } {
  return { mode: inferMode(request), brief: compileExecutionBrief(request) };
}
