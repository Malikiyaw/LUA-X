import { describe, expect, it } from 'vitest';
import { beginExecution, complete, createSession, nextExecutableWork, requestRepair, setPlan } from './index.js';

describe('autonomous engine', () => {
  const goal = { id: 'game', description: 'Build a small game loop', priority: 'high' as const, acceptanceCriteria: ['AC-1'] };
  it('requires a goal and acceptance criteria', () => {
    expect(() => createSession({ ...goal, description: '' })).toThrow();
    expect(() => createSession({ ...goal, acceptanceCriteria: [] })).toThrow();
  });
  it('enforces dependencies', () => {
    let s = createSession(goal);
    s = setPlan(s, { id: 'p1', goalId: 'game', generatedAt: new Date().toISOString(), work: [
      { id: 'a', kind: 'architecture', title: 'plan', description: 'plan', dependsOn: [], risk: 'low', acceptanceCriteria: ['AC-1'] },
      { id: 'b', kind: 'code', title: 'build', description: 'build', dependsOn: ['a'], risk: 'medium', acceptanceCriteria: ['AC-1'] }
    ]});
    expect(nextExecutableWork(s, new Set()).map(x => x.id)).toEqual(['a']);
    expect(nextExecutableWork(s, new Set(['a'])).map(x => x.id)).toEqual(['b']);
  });
  it('requires approval before execution', () => {
    let s = createSession(goal);
    expect(() => beginExecution(s)).toThrow();
    s = setPlan(s, { id: 'p', goalId: 'game', generatedAt: new Date().toISOString(), work: [] });
    expect(beginExecution(s).status).toBe('executing');
  });
  it('bounds repair attempts and requires evidence to complete', () => {
    let s = createSession(goal, 1);
    s = requestRepair(s, 'runtime failure', true);
    expect(s.repairAttempts).toBe(1);
    s = requestRepair(s, 'runtime failure again', true);
    expect(s.status).toBe('blocked');
    expect(() => complete(s, [])).toThrow();
  });
});
