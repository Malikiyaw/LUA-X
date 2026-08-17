import { describe, expect, it } from 'vitest';
import { createWorkspace, registerItem, routeTask, startTask } from './index.js';

describe('fusion core', () => {
  it('creates a workspace', () => expect(createWorkspace('game').projectId).toBe('game'));
  it('rejects duplicate items', () => { const s = registerItem(createWorkspace('game'), { id: 'x', surface: 'code', title: 'x', dirty: false }); expect(() => registerItem(s, { id: 'x', surface: 'ui', title: 'x2', dirty: false })).toThrow(); });
  it('routes one unified task to multiple unique surfaces', () => expect(routeTask({ id: '1', prompt: 'boss', surfaces: ['code','animation','code','ui'], acceptanceCriteria: ['works'], requiresStudio: true })).toEqual(['code','animation','ui']));
  it('starts on the first relevant surface', () => expect(startTask(createWorkspace('game'), { id: '1', prompt: 'boss', surfaces: ['world','code'], acceptanceCriteria: ['works'], requiresStudio: true }).activeSurface).toBe('world'));
});
