import { describe, expect, it } from 'vitest';
import { classifyFailure, createVerificationRun, evaluateRun, repairPlan, recordResult } from './index.js';

describe('verification engine', () => {
  const base = () => createVerificationRun({ id: 'run-1', startedAt: new Date().toISOString(), tests: [{ id: 't1', name: 'works', kind: 'unit', steps: ['run'], expected: ['success'], priority: 'high' }], criteria: [{ id: 'AC-1', description: 'works', required: true }] });
  it('passes only with evidence-backed required criteria', () => {
    let run = base();
    run = recordResult(run, { testId: 't1', status: 'passed', evidence: [{ type: 'assertion', summary: 'AC-1 verified' }] });
    expect(evaluateRun(run).passed).toBe(true);
  });
  it('fails when a test fails', () => {
    let run = base();
    run = recordResult(run, { testId: 't1', status: 'failed', evidence: [], failure: { kind: 'runtime', message: 'runtime error', recoverable: true } });
    expect(evaluateRun(run).passed).toBe(false);
  });
  it('classifies failures and creates a repair plan', () => {
    const failure = { kind: classifyFailure('FPS performance timeout'), message: 'FPS performance timeout', recoverable: true } as const;
    expect(failure.kind).toBe('performance');
    expect(repairPlan(failure).action).toBe('repair');
  });
  it('escalates non-recoverable failures', () => {
    expect(repairPlan({ kind: 'security', message: 'critical permission issue', recoverable: false }).action).toBe('escalate');
  });
});
