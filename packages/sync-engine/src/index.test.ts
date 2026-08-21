import { describe, it, expect } from 'vitest';
import { createSyncState, startFullSync, defaultConfig, handleStudioChange, handleLocalChange, handleDelete, categorizeFile, getSyncStatus, generateSourcemap, querySync } from './index.js';

describe('sync-engine', () => {
  it('creates per-Place isolated mirror', () => {
    const state = createSyncState();
    const cfg = defaultConfig();
    startFullSync(state, 'place_1', 'Game', { scripts: [{ path: 'game.ServerScriptService.Main', source: 'print(1)' }] }, cfg);
    startFullSync(state, 'place_2', 'Lobby', { scripts: [{ path: 'game.ReplicatedStorage.Shared', source: 'return {}' }] }, cfg);
    expect(state.places.size).toBe(2);
    expect(state.places.get('place_1')?.files.length).toBe(1);
    expect(state.activePlaceId).toBe('place_2');
  });
  it('evicts LRU after 5 Places', () => {
    const state = createSyncState();
    for (let i = 0; i < 6; i++) startFullSync(state, `p${i}`, 'G', { scripts: [] });
    expect(state.places.size).toBe(5);
    expect(state.places.has('p0')).toBe(false);
  });
  it('enforces forward/manual and reverse queue', () => {
    const state = createSyncState();
    const cfg = defaultConfig();
    startFullSync(state, 'p', 'G', { scripts: [] }, cfg);
    const w = handleStudioChange(state, 'p', 'x.server.luau', 'scripts', cfg);
    expect(w.action).toBe('write');
    const q = handleLocalChange(state, 'p', 'x.server.luau', 'scripts', cfg);
    expect(q.action).toBe('restoreDirty');
    cfg.direction.scripts = 'reverse';
    const r = handleStudioChange(state, 'p', 'x.server.luau', 'scripts', cfg);
    expect(r.action).toBe('queueRestore');
  });
  it('delete always manual unless autoApplyDeletes', () => {
    const state = createSyncState();
    const cfg = defaultConfig();
    startFullSync(state, 'p', 'G', { scripts: [] }, cfg);
    expect(handleDelete(state, 'p', 'x', 'scripts', cfg).action).toBe('queuedManual');
    cfg.autoApplyDeletes = true;
    expect(handleDelete(state, 'p', 'x', 'scripts', cfg).action).toBe('auto');
  });
  it('categorizes files', () => {
    expect(categorizeFile('A/B.server.luau')).toBe('scripts');
    expect(categorizeFile('A/B.value.json')).toBe('values');
    expect(categorizeFile('A/_tree.json')).toBe('containers');
  });
  it('generates sourcemap', () => {
    const state = createSyncState();
    startFullSync(state, 'p', 'G', { scripts: [{ path: 'game.ServerScriptService.Foo', source: 'x' }] });
    const sm = generateSourcemap(state, 'p');
    expect(sm?.filePaths[0]).toContain('lua-x-sync');
    expect(sm?.filePaths[0]).toContain('Foo');
    expect(getSyncStatus(state, 'p')?.files).toBe(1);
    expect(querySync(state, 'p', 'Foo').length).toBe(1);
  });
});
