import test from 'node:test';
import assert from 'node:assert/strict';
import { buildProjectIndex, getIndexStats, inferScriptContainer, queryProjectIndex } from './index.js';

test('infers Roblox script containers', () => {
  assert.equal(inferScriptContainer('game.ServerScriptService.Main', 'Script'), 'Server');
  assert.equal(inferScriptContainer('game.StarterPlayer.StarterPlayerScripts.Client', 'LocalScript'), 'Client');
  assert.equal(inferScriptContainer('game.ReplicatedStorage.Shared', 'ModuleScript'), 'Shared');
});

test('builds a deduplicated project index', () => {
  const index = buildProjectIndex({
    rootName: 'TestGame',
    instances: [
      { path: 'game.ServerScriptService.Main', name: 'Main', className: 'Script', parentPath: 'game.ServerScriptService', childrenCount: 0 },
      { path: 'game.ReplicatedStorage.Remotes.Attack', name: 'Attack', className: 'RemoteEvent', parentPath: 'game.ReplicatedStorage.Remotes', childrenCount: 0 },
    ],
    scripts: [{ path: 'game.ServerScriptService.Main', name: 'Main', kind: 'Script', container: 'Unknown', requires: ['game.ReplicatedStorage.Shared'], services: ['Players'], remotes: ['game.ReplicatedStorage.Remotes.Attack'] }],
    remotes: [{ path: 'game.ReplicatedStorage.Remotes.Attack', name: 'Attack', className: 'RemoteEvent', location: 'ReplicatedStorage', callers: ['game.ServerScriptService.Main'] }],
    services: ['Players', 'Players'],
  });

  assert.equal(index.scripts[0]?.container, 'Server');
  assert.deepEqual(index.services, ['Players']);
  assert.equal(index.dependencies.length, 3);
  assert.equal(index.warnings.length, 0);
});

test('queries project intelligence without mutating the index', () => {
  const index = buildProjectIndex({
    rootName: 'TestGame',
    instances: [{ path: 'game.ServerScriptService.Combat', name: 'Combat', className: 'ModuleScript', parentPath: 'game.ServerScriptService', childrenCount: 0 }],
    scripts: [{ path: 'game.ServerScriptService.Combat', name: 'Combat', kind: 'ModuleScript', container: 'Server', requires: [], services: [], remotes: ['game.ReplicatedStorage.Attack'] }],
  });
  const result = queryProjectIndex(index, 'combat');
  assert.equal(result.scripts.length, 1);
  assert.equal(index.instances.length, 1);
});

test('reports useful stats', () => {
  const index = buildProjectIndex({ rootName: 'TestGame', instances: [], scripts: [], remotes: [], assets: [], dependencies: [], services: [] });
  assert.deepEqual(getIndexStats(index), { instances: 0, scripts: 0, serverScripts: 0, clientScripts: 0, sharedScripts: 0, remotes: 0, assets: 0, dependencies: 0, services: 0, warnings: 0 });
});
