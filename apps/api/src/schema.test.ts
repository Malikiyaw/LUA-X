import { describe, expect, it } from 'vitest';
import { parseAIPlan } from './schema.js';

describe('AI plan schema', () => {
  it('accepts valid structured output', () => {
    const plan = parseAIPlan(JSON.stringify({ summary: 'Build combat', assumptions: [], changes: [{ operation: 'create_script', target: 'ServerScriptService/Combat.luau', content: 'print(1)', reason: 'combat server logic', risk: 'medium' }], acceptanceCriteria: ['damage works'], verification: ['playtest'], risks: [] }));
    expect(plan.changes[0]?.operation).toBe('create_script');
  });
  it('accepts JSON fenced output', () => expect(parseAIPlan('```json\n{"summary":"x","assumptions":[],"changes":[],"acceptanceCriteria":["x"],"verification":["x"],"risks":[]}\n```').summary).toBe('x'));
  it('rejects malformed plans', () => expect(() => parseAIPlan('{"summary":"x"}')).toThrow());
  it('rejects unknown operations', () => expect(() => parseAIPlan(JSON.stringify({ summary: 'x', assumptions: [], changes: [{ operation: 'run_shell', target: 'x', reason: 'x', risk: 'high' }], acceptanceCriteria: ['x'], verification: ['x'], risks: [] }))).toThrow());
});
