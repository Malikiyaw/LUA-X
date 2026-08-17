import test from "node:test";
import assert from "node:assert/strict";
import { compileExecutionBrief, orchestrate } from "./index.js";
import { assessChangeRisk, createChangeSet } from "./change-set.js";
import { InMemoryProjectMemory } from "./memory.js";
import { decomposeBrief } from "./planner.js";
import { compileModelPrompt } from "./prompt-compiler.js";

test("Phase 2 compiles a multi-system request into specialist work", () => {
  const brief = compileExecutionBrief({
    prompt: "Create an animated HUD feature, optimize it, secure its server requests, and test it.",
    projectId: "demo",
  });
  assert.equal(brief.project.projectId, "demo");
  assert.ok(brief.specialistAgents.includes("architect"));
  assert.ok(brief.specialistAgents.includes("animation"));
  assert.ok(brief.specialistAgents.includes("ui"));
  assert.ok(brief.specialistAgents.includes("security"));
  assert.ok(brief.specialistAgents.includes("performance"));
  assert.ok(brief.specialistAgents.includes("playtest"));
  assert.ok(brief.specialistAgents.includes("luau"));
  assert.ok(brief.specialistAgents.includes("reviewer"));
});

test("planner creates dependency-aware tasks", () => {
  const brief = compileExecutionBrief({ prompt: "Build a UI system." });
  const plan = decomposeBrief(brief);
  assert.ok(plan.tasks.length >= 3);
  assert.equal(plan.tasks[0]?.dependsOn.length, 0);
  assert.deepEqual(plan.tasks[1]?.dependsOn, [plan.tasks[0]?.id]);
  assert.equal(plan.changeSet.status, "draft");
});

test("prompt compiler keeps acceptance and verification explicit", () => {
  const brief = compileExecutionBrief({ prompt: "Build a data-backed menu.", projectId: "p1" });
  const plan = decomposeBrief(brief);
  const compiled = compileModelPrompt(brief, plan);
  assert.match(compiled.system, /Do not invent Roblox APIs/);
  assert.match(compiled.task, /Creator intent/);
  assert.match(compiled.acceptance, /reviewable change set/);
  assert.match(compiled.verification, /automated tests/);
});

test("orchestrate includes project memory without making it mandatory", () => {
  const memory = new InMemoryProjectMemory();
  memory.put({
    id: "m1",
    projectId: "p1",
    kind: "convention",
    content: "Use strict Luau types for gameplay modules.",
    source: "creator",
    confidence: 1,
    tags: ["luau"],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  });
  const result = orchestrate({ prompt: "Refactor the gameplay module.", projectId: "p1" }, memory);
  assert.match(result.compiledPrompt.context, /strict Luau types/);
});

test("change sets are deterministic for identical proposals", () => {
  const proposals = [{
    operation: "update" as const,
    target: "game.ServerScriptService.Test",
    reason: "Apply requested change",
    agent: "luau" as const,
    risk: "low" as const,
    dependsOn: [],
    expectedEffect: "Update one script.",
    reversible: true,
  }];
  const first = createChangeSet("test", proposals);
  const second = createChangeSet("test", proposals);
  assert.equal(first.id, second.id);
  assert.equal(first.proposals[0]?.id, second.proposals[0]?.id);
  assert.equal(assessChangeRisk(proposals), "low");
});

test("memory rejects invalid confidence", () => {
  const memory = new InMemoryProjectMemory();
  assert.throws(() => memory.put({
    id: "bad",
    projectId: "p",
    kind: "decision",
    content: "bad",
    source: "creator",
    confidence: 2,
    tags: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  }));
});
