import { describe, expect, it } from 'vitest';
import {
  RobloxMcpBridge,
  type RobloxMcpRequest,
  type RobloxMcpTransport,
} from './index.js';

function createTestTransport(): { transport: RobloxMcpTransport; calls: RobloxMcpRequest[] } {
  const calls: RobloxMcpRequest[] = [];
  const transport: RobloxMcpTransport = {
    async call(request: RobloxMcpRequest) {
      calls.push(request);
      return { ok: true, tool: request.tool, data: { accepted: true } };
    },
  };
  return { calls, transport };
}

describe('RobloxMcpBridge', () => {
  it('classifies supported read and write tools', () => {
    const { transport } = createTestTransport();
    const bridge = new RobloxMcpBridge({ transport });
    expect(bridge.classify('script_read')).toBe('read');
    expect(bridge.classify('multi_edit')).toBe('write');
    expect(bridge.classify('made_up_tool')).toBe('unknown');
  });

  it('rejects unknown tools before transport execution', async () => {
    const { transport, calls } = createTestTransport();
    const bridge = new RobloxMcpBridge({ transport });
    const result = await bridge.call({ tool: 'made_up_tool', arguments: {} });
    expect(result.ok).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it('requires confirmation for mutations when configured', async () => {
    const { transport, calls } = createTestTransport();
    const bridge = new RobloxMcpBridge({ transport, requireConfirmation: true });
    const blocked = await bridge.editScript('game.ServerScriptService.Main', [], false);
    expect(blocked.ok).toBe(false);
    expect(calls).toHaveLength(0);

    const allowed = await bridge.editScript('game.ServerScriptService.Main', [], true);
    expect(allowed.ok).toBe(true);
    expect(calls).toHaveLength(1);
  });

  it('builds safe read requests', async () => {
    const { transport, calls } = createTestTransport();
    const bridge = new RobloxMcpBridge({ transport });
    await bridge.readScript('game.ServerScriptService.Main', 5, 12);
    expect(calls[0]).toEqual({
      tool: 'script_read',
      arguments: { path: 'game.ServerScriptService.Main', start_line: 5, end_line: 12 },
    });
  });

  it('passes Studio execution mode explicitly', async () => {
    const { transport, calls } = createTestTransport();
    const bridge = new RobloxMcpBridge({ transport });
    await bridge.executeLuau('return 1', 'Edit');
    expect(calls[0]).toEqual({
      tool: 'execute_luau',
      arguments: { code: 'return 1', datamodel_type: 'Edit' },
    });
  });
});
