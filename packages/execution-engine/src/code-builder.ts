import type { ExecutionBrief } from "@lua-x/shared";
import { createChangeSet, type CodeChangeSet, type CodeOperation, type RiskLevel } from "./index.js";

export interface CodeModel {
  generate(input: {
    readonly systemPrompt: string;
    readonly userPrompt: string;
  }): Promise<string>;
}

export interface CodeBuildContext {
  readonly brief: ExecutionBrief;
  readonly existingFiles: readonly { path: string; content: string }[];
  readonly existingInstances: readonly string[];
}

const SYSTEM_PROMPT = `You are the LUA-X Roblox Luau engineer. Produce a minimal, maintainable implementation that fits the supplied project context. Never invent Roblox APIs, project files, instance paths, asset IDs, or test results. Respect server authority and preserve unrelated behavior. Return only a machine-readable JSON plan with operations; do not execute anything. Each operation must contain kind, target, content when applicable, reason, and risk.`;

function extractJson(text: string): unknown {
  const trimmed = text.trim();
  const withoutFence = trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  return JSON.parse(withoutFence);
}

function validateOperation(value: unknown, index: number): CodeOperation {
  if (!value || typeof value !== "object") throw new Error(`Generated operation ${index} is not an object.`);
  const item = value as Record<string, unknown>;
  const kind = item.kind;
  const target = item.target;
  const reason = item.reason;
  const risk = item.risk;
  const allowedKinds = ["create-script", "replace-script", "edit-script", "delete-script"];
  const allowedRisks = ["low", "medium", "high", "critical"];
  if (!allowedKinds.includes(String(kind))) throw new Error(`Generated operation ${index} has an invalid operation kind.`);
  if (typeof target !== "string" || !target.startsWith("game.")) throw new Error(`Generated operation ${index} has an invalid Roblox target.`);
  if (typeof reason !== "string" || reason.trim().length === 0) throw new Error(`Generated operation ${index} is missing a reason.`);
  if (!allowedRisks.includes(String(risk))) throw new Error(`Generated operation ${index} has an invalid risk level.`);
  if ((kind === "create-script" || kind === "replace-script" || kind === "edit-script") && typeof item.content !== "string") {
    throw new Error(`Generated operation ${index} requires content.`);
  }
  return {
    id: `generated_${index + 1}`,
    kind: kind as CodeOperation["kind"],
    target,
    datamodelType: "Edit",
    content: typeof item.content === "string" ? item.content : undefined,
    expectedHash: typeof item.expectedHash === "string" ? item.expectedHash : undefined,
    reason,
    risk: risk as RiskLevel,
  };
}

export function buildModelPrompt(context: CodeBuildContext): string {
  return [
    "PROJECT CONTEXT:",
    JSON.stringify({ files: context.existingFiles, instances: context.existingInstances }, null, 2),
    "EXECUTION BRIEF:",
    JSON.stringify(context.brief, null, 2),
    "OUTPUT CONTRACT:",
    JSON.stringify({ operations: [{ kind: "create-script|replace-script|edit-script|delete-script", target: "game...", content: "...", reason: "...", risk: "low|medium|high|critical" }] }),
    "Return no prose outside JSON.",
  ].join("\n\n");
}

export async function generateChangeSet(model: CodeModel, context: CodeBuildContext): Promise<CodeChangeSet> {
  const response = await model.generate({ systemPrompt: SYSTEM_PROMPT, userPrompt: buildModelPrompt(context) });
  let parsed: unknown;
  try {
    parsed = extractJson(response);
  } catch {
    throw new Error("AI code output was not valid JSON; no changes were created.");
  }
  if (!parsed || typeof parsed !== "object" || !Array.isArray((parsed as { operations?: unknown }).operations)) {
    throw new Error("AI code output must contain an operations array; no changes were created.");
  }
  const operations = (parsed as { operations: unknown[] }).operations.map(validateOperation);
  return createChangeSet(context.brief, operations);
}
