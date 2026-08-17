import test from "node:test";
import assert from "node:assert/strict";
import type { ExecutionBrief } from "@lua-x/shared";
import { DryRunAdapter, applyChangeSet, createChangeSet, requiresApproval, type CodeOperation } from "./index.js";

const brief: ExecutionBrief = {
  objective: { summary: "Add a test system", userIntent: "Add a test system" },
  project: { projectId: "demo", relevantFiles: [], relevantInstances: [] },
  constraints: { mustPreserve: [], security: [], performance: [] },
  acceptanceCriteria: ["Works"],
  verification: ["Test it"],
  specialistAgents: ["architect", "luau", "reviewer"],
};

function operation(overrides: Partial<CodeOperation> = {}): CodeOperation {
  return {
    id: "op_1",
    kind: "create-script",
    target: "game.ServerScriptService.Test",
    datamodelType: "Edit",
    content: "print('ok')",
    reason: "test",
    risk: "low",
    ...overrides,
  };
}

test("change-set ids are deterministic", () => {
  const a = createChangeSet(brief, [operation()]);
  const b = createChangeSet(brief, [operation()]);
  assert.equal(a.id, b.id);
});

test("medium risk requires approval by default", () => {
  assert.equal(requiresApproval(operation({ risk: "medium" })), true);
  assert.equal(requiresApproval(operation({ risk: "low" })), false);
});

test("unapproved risky changes are blocked", async () => {
  const adapter = new DryRunAdapter();
  const result = await applyChangeSet(createChangeSet(brief, [operation({ risk: "high" })]), adapter);
  assert.equal(result.status, "blocked");
  assert.equal(adapter.applied.length, 0);
});

test("approved changes execute in order", async () => {
  const adapter = new DryRunAdapter();
  const changeSet = createChangeSet(brief, [operation(), operation({ id: "op_2", target: "game.ServerScriptService.Test2" })]);
  const result = await applyChangeSet(changeSet, adapter, { approvedChangeSetId: changeSet.id });
  assert.equal(result.status, "applied");
  assert.deepEqual(adapter.applied.map((item) => item.id), ["op_1", "op_2"]);
});

test("deletion is blocked unless explicitly enabled", async () => {
  const adapter = new DryRunAdapter();
  const changeSet = createChangeSet(brief, [operation({ kind: "delete-script", risk: "high" })]);
  const result = await applyChangeSet(changeSet, adapter, { approvedChangeSetId: changeSet.id });
  assert.equal(result.status, "blocked");
});

test("stale replacement is rejected", async () => {
  const adapter: DryRunAdapter = new DryRunAdapter();
  adapter.readScript = async () => ({ content: "new", hash: "actual" });
  const changeSet = createChangeSet(brief, [operation({ kind: "replace-script", expectedHash: "old", risk: "high" })]);
  const result = await applyChangeSet(changeSet, adapter, { approvedChangeSetId: changeSet.id });
  assert.equal(result.status, "blocked");
  assert.equal(result.evidence[0]?.message.includes("changed"), true);
});
