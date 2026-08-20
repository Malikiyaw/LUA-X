import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { VERSION, can, healthStatus, stableId, ROLE_RANK, type Role } from './index.js';

describe('stableId', () => {
  it('is deterministic for the same input', () => {
    assert.equal(stableId('chg', 'project-x|game.ServerScriptService.Foo'), stableId('chg', 'project-x|game.ServerScriptService.Foo'));
  });

  it('produces distinct ids for different inputs', () => {
    assert.notEqual(stableId('chg', 'a'), stableId('chg', 'b'));
  });

  it('keeps namespaces distinct via prefix', () => {
    assert.match(stableId('chg', 'input'), /^chg_[0-9a-f]{8}$/);
    assert.match(stableId('cs', 'input'), /^cs_[0-9a-f]{8}$/);
    assert.notEqual(stableId('chg', 'input'), stableId('cs', 'input'));
  });

  it('is 32-bit unsigned hex', () => {
    assert.match(stableId('id', 'anything'), /^id_[0-9a-f]{8}$/);
  });
});

describe('Role hierarchy', () => {
  it('ranks roles in order', () => {
    assert.equal(ROLE_RANK.viewer, 0);
    assert.equal(ROLE_RANK.owner, 5);
    assert.ok(ROLE_RANK.developer > ROLE_RANK.designer);
  });

  it('can() grants at-or-above required role', () => {
    assert.equal(can('owner', 'viewer'), true);
    assert.equal(can('viewer', 'viewer'), true);
    assert.equal(can('designer', 'developer'), false);
    assert.equal(can('admin', 'owner'), false);
    assert.equal(can('developer', 'designer'), true);
  });
});

describe('healthStatus', () => {
  it('reports ok with the shared version', () => {
    const health = healthStatus();
    assert.deepEqual(health, { service: 'lua-x', status: 'ok', version: VERSION });
    assert.equal(health.version, '0.2.0');
  });
});

describe('can() type safety', () => {
  it('accepts every Role value', () => {
    const roles: readonly Role[] = ['owner', 'admin', 'developer', 'designer', 'reviewer', 'viewer'];
    for (const role of roles) assert.equal(typeof can(role, 'viewer'), 'boolean');
  });
});