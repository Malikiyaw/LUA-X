import { RobloxMcpBridge } from '@lua-x/roblox-mcp-bridge';
import { StdioMcpTransport } from './stdio-transport.js';

export interface ProxyConfig {
  apiBase: string;
  token?: string;
  studioId?: string;
  pollMs?: number;
}

export function createBridge(studioId?: string) {
  const transport = new StdioMcpTransport({ ...(studioId ? { studioId } : {}) });
  return new RobloxMcpBridge({ transport, requireConfirmation: true });
}

export async function pollAndBridge(config: ProxyConfig) {
  const bridge = createBridge(config.studioId);
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (config.token) headers['authorization'] = `Bearer ${config.token}`;

  let sessionId: string | null = null;

  const apiBase = config.apiBase.replace(/\/$/, '');

  // 1) claim pending connect if any (Phase 1: proxy also claims website pending requests)
  try {
    const pending = await fetch(`${apiBase}/api/studio/connect/pending`, { headers }).then(r => r.json() as Promise<{ request: { requestId: string; projectId?: string } | null }>);
    if (pending.request) {
      const proxyId = `proxy-${Date.now().toString(36)}`;
      const reg = await fetch(`${apiBase}/api/studio/register`, {
        method: 'POST', headers,
        body: JSON.stringify({ projectId: pending.request.projectId || 'desktop-proxy', sessionId: proxyId, placeName: 'Proxy (desktop-bridge)', pluginVersion: '2.2.0', capabilities: ['mcp','sync','mesh','vision','chat','playtest','assets'], clientId: proxyId, requestId: pending.request.requestId })
      });
      const j = await reg.json() as { sessionId?: string };
      if (j.sessionId) sessionId = j.sessionId;
      else sessionId = proxyId;
      console.log(`[lua-x] claimed connect ${pending.request.requestId} as ${sessionId}`);
    }
  } catch { /* ignore */ }

  // 2) poll commands and forward to MCP
  setInterval(async () => {
    if (!sessionId) {
      try {
        const s = await fetch(`${apiBase}/api/studio/status?projectId=desktop-proxy`, { headers }).then(r => r.json() as Promise<{ sessionId?: string; connected?: boolean }>);
        if (s.sessionId && s.connected) sessionId = s.sessionId;
      } catch { /* */ }
      return;
    }
    try {
      const cmdRes = await fetch(`${apiBase}/api/studio/command?sessionId=${sessionId}`, { headers }).then(r => r.json() as Promise<{ command?: { type: string; prompt?: string } }>);
      const cmd = cmdRes.command;
      if (!cmd) return;
      console.log(`[lua-x] command ${cmd.type}`);
      let result: unknown = { ok: true };
      if (cmd.type === 'ping') result = await bridge.call({ tool: 'get_studio_state', arguments: {} });
      else if (cmd.type === 'build' && cmd.prompt) {
        // For build, just report that proxy received it - real plan apply happens via generate_mesh/multi_edit from cloud
        result = { ok: true, proxied: true, note: 'Build plan routing via website chat — see /api/ai/generate' };
      } else if (cmd.type === 'refresh_context') {
        const tree = await bridge.call({ tool: 'search_game_tree', arguments: { depth: 8 } });
        result = tree;
      } else if (cmd.type === 'verify' || cmd.type === 'analyze') {
        result = await bridge.call({ tool: 'get_console_output', arguments: {} });
      }
      await fetch(`${apiBase}/api/studio/apply`, { method: 'POST', headers, body: JSON.stringify({ sessionId, planSummary: `proxy:${cmd.type}`, success: 1, failed: 0, results: [JSON.stringify(result).slice(0, 900)] }) });
    } catch (e) { console.error('[proxy]', e); }
  }, config.pollMs ?? 2000);

  // heartbeat via MCP get_studio_state
  setInterval(async () => {
    try { await bridge.studioState(); } catch { /* */ }
  }, 4000);
}
