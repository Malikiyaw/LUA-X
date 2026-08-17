import { describe, expect, it } from 'vitest';
import { addMember, can, createProject, createSnapshot } from './index.js';

describe('cloud core', () => {
  it('creates owner project and permissions', () => { const p = createProject('p','Game','u1'); expect(can(p.members[0], 'admin')).toBe(true); });
  it('requires admin to add members', () => { const p = createProject('p','Game','u1'); expect(() => addMember(p, { userId:'u2', role:'viewer' }, { userId:'u3', role:'developer' })).toThrow(); });
  it('prevents empty snapshots', () => expect(() => createSnapshot('p','x',[])).toThrow());
});
