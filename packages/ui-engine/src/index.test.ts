import { describe, expect, it } from 'vitest';
import { createScreen, validateScreen } from './index.js';

describe('UI engine', () => {
  it('creates a valid screen', () => {
    const screen = createScreen({ id: 'hud', name: 'HUD', rootId: 'root', theme: { tokens: { gap: 8 } }, responsive: { rules: ['stack actions below 420px'] }, components: [{ id: 'root', kind: 'screen', name: 'Root' }] });
    expect(validateScreen(screen).filter(i => i.severity === 'error')).toHaveLength(0);
  });
  it('rejects missing parents and duplicate ids', () => {
    const screen = createScreen({ id: 'x', name: 'X', rootId: 'root', theme: { tokens: {} }, responsive: { rules: [] }, components: [{ id: 'root', kind: 'screen', name: 'Root' }, { id: 'a', kind: 'frame', name: 'A', parentId: 'missing' }, { id: 'a', kind: 'frame', name: 'A2' }] });
    const codes = validateScreen(screen).map(i => i.code);
    expect(codes).toContain('MISSING_PARENT'); expect(codes).toContain('DUPLICATE_COMPONENT');
  });
  it('validates transparency', () => {
    const screen = createScreen({ id: 'x', name: 'X', rootId: 'root', theme: { tokens: {} }, responsive: { rules: [] }, components: [{ id: 'root', kind: 'screen', name: 'Root' }, { id: 'b', kind: 'button', name: 'B', style: { transparency: 2 } }] });
    expect(validateScreen(screen).some(i => i.code === 'TRANSPARENCY_RANGE')).toBe(true);
  });
});
