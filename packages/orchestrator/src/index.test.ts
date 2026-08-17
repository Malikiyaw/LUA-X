import test from "node:test";
import assert from "node:assert/strict";
import { compileExecutionBrief } from "./index.js";

test("compiles a Roblox feature request into a structured brief", () => {
  const brief = compileExecutionBrief({
    prompt: "Create a secure sword attack animation with a HUD cooldown and playtest it.",
    projectId: "demo-project",
  });

  assert.equal(brief.project.projectId, "demo-project");
  assert.equal(brief.objective.userIntent, "Create a secure sword attack animation with a HUD cooldown and playtest it.");
  assert.ok(brief.specialistAgents.includes("animation"));
  assert.ok(brief.specialistAgents.includes("ui"));
  assert.ok(brief.specialistAgents.includes("security"));
  assert.ok(brief.specialistAgents.includes("playtest"));
  assert.ok(brief.specialistAgents.includes("reviewer"));
});

test("rejects empty creator prompts", () => {
  assert.throws(() => compileExecutionBrief({ prompt: "   " }), /cannot be empty/);
});
