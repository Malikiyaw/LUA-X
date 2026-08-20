import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { generateAIPlan, parseAIPlan, preparePipeline, orchestrate, type AIRequest, type ChatProvider } from './index.js';

const VALID_PLAN = {
  summary: 'Add a sprint system',
  assumptions: ['Player controller exists'],
  changes: [
    { operation: 'create_script', target: 'game.ServerScriptService.Sprint', content: 'print("sprint")', reason: 'Adds sprint logic', risk: 'low' },
    { operation: 'note', target: 'game', reason: 'Upload VFX assets', risk: 'low' },
  ],
  acceptanceCriteria: ['Sprint drains stamina'],
  verification: ['Script loads without errors'],
  risks: ['Stamina tuning needed'],
};

function planText(plan: unknown = VALID_PLAN): string {
  return JSON.stringify(plan);
}

function fakeProvider(content: string): ChatProvider {
  return {
    chat: async () => ({ content }),
  };
}

const REQUEST: AIRequest = {
  prompt: 'Add a sprint system with a stamina bar.',
  mode: 'build',
  projectId: 'proj-test',
};

describe('parseAIPlan', () => {
  it('parses a plain JSON plan', () => {
    const plan = parseAIPlan(planText());
    assert.equal(plan.summary, 'Add a sprint system');
    assert.equal(plan.changes.length, 2);
    assert.equal(plan.changes[0]?.operation, 'create_script');
  });

  it('parses a fenced JSON plan', () => {
    const plan = parseAIPlan('```json\n' + planText() + '\n```');
    assert.equal(plan.summary, 'Add a sprint system');
  });

  it('extracts a JSON object embedded in prose', () => {
    const plan = parseAIPlan('Here is the plan:\n' + planText() + '\nLet me know if you need changes.');
    assert.equal(plan.changes.length, 2);
  });

  it('rejects a truncated plan', () => {
    const truncated = planText().slice(0, Math.floor(planText().length / 2));
    assert.throws(() => parseAIPlan(truncated), /No valid JSON object/);
  });

  it('rejects invalid operations and risks', () => {
    const bad = { ...VALID_PLAN, changes: [{ operation: 'drop_table', target: 'x', reason: 'y', risk: 'low' }] };
    assert.throws(() => parseAIPlan(planText(bad)), /unsupported operation/);
    const risky = { ...VALID_PLAN, changes: [{ operation: 'note', target: 'x', reason: 'y', risk: 'extreme' }] };
    assert.throws(() => parseAIPlan(planText(risky)), /risk is invalid/);
  });

  it('rejects missing required fields', () => {
    assert.throws(() => parseAIPlan(planText({ ...VALID_PLAN, summary: '' })), /summary is missing/);
    assert.throws(() => parseAIPlan(planText({ ...VALID_PLAN, changes: 'nope' })), /changes are invalid/);
  });
});

describe('generateAIPlan', () => {
  it('returns a validated plan and pipeline from the provider', async () => {
    const provider = fakeProvider(planText());
    const result = await generateAIPlan(REQUEST, provider);
    assert.equal(result.plan.summary, 'Add a sprint system');
    assert.equal(result.plan.changes.length, 2);
    assert.equal(result.pipeline.mode, 'build');
    assert.equal(result.pipeline.health.dependencies.studio, 'down');
    assert.equal(result.pipeline.health.ok, false);
  });

  it('rejects an empty prompt', async () => {
    const provider = fakeProvider(planText());
    await assert.rejects(generateAIPlan({ prompt: '   ' }, provider), /cannot be empty/);
  });

  it('propagates a non-plan provider response as a parse error', async () => {
    const provider = fakeProvider('I cannot build a plan right now.');
    await assert.rejects(generateAIPlan(REQUEST, provider), /No valid JSON object/);
  });
});

describe('preparePipeline', () => {
  it('builds a complete execution pipeline with capability checks', () => {
    const orchestration = orchestrate(REQUEST);
    const plan = parseAIPlan(planText());
    const pipeline = preparePipeline(REQUEST, plan, orchestration, new Date('2026-01-01T00:00:00Z'));
    assert.ok(pipeline.workspace.id.length > 0);
    assert.equal(pipeline.executionChangeSet.operations.filter((op) => op.kind === 'create-script').length, 1);
    assert.equal(pipeline.capabilityChecks.animation.valid, true);
    assert.equal(pipeline.studio.connected, false);
  });
});