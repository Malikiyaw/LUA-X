import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { basicLuauIssue } from './agent-core.js';

describe('basicLuauIssue', () => {
  it('accepts clean Lua', () => {
    const source = [
      'local Config = { Damage = 25 }',
      'local function hit(target)',
      '  print("hit " .. tostring(target))',
      'end',
      'return Config',
    ].join('\n');
    assert.equal(basicLuauIssue(source), null);
  });

  it('rejects empty content', () => {
    assert.match(basicLuauIssue('') ?? '', /empty/);
    assert.match(basicLuauIssue('   \n  ') ?? '', /empty/);
  });

  it('detects truncated string literals', () => {
    const source = 'local msg = "hello world';
    assert.match(basicLuauIssue(source) ?? '', /unterminated string/);
  });

  it('detects unbalanced parentheses from truncation', () => {
    const source = 'local function run(a, b)\n  return math.max(a, b\nend';
    assert.match(basicLuauIssue(source) ?? '', /unbalanced brackets/);
  });

  it('detects unterminated block comments', () => {
    const source = '--[[ never closed\nprint(1)';
    assert.match(basicLuauIssue(source) ?? '', /block comment/);
  });

  it('ignores Luau-only syntax that a structural gate must not reject', () => {
    const source = 'type State = { hp: number }\nlocal x = 1\nx += 1\ncontinue_test = "ok"';
    assert.equal(basicLuauIssue(source), null);
  });

  it('allows brackets inside strings and comments', () => {
    const source = 'local s = "( [ {"\n-- ) ] }\nprint(s)';
    assert.equal(basicLuauIssue(source), null);
  });
});
