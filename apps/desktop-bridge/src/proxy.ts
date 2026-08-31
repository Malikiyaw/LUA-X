import { RobloxMcpBridge } from '@lua-x/roblox-mcp-bridge';
import { AgentRuntime, type BuildPlan } from './agent-runtime.js';
import { StdioMcpTransport } from './stdio-transport.js';

export interface ProxyConfig {
  apiBase: string;
  token?: string;
  studioId?: string;
  pollMs?: number;
  projectId?: string;
}

function headers(token?: string): Record<string, string> {
  const value: Record<string, string> = { 'content-type': 'application/json' };
  if (token) value.authorization = `Bearer ${token}`;
  return value;
}

async function postJson(url: string, body: unknown, token?: string): Promise<any> {
  const response = await fetch(url, { method: 'POST', headers: headers(token), body: JSON.stringify(body) });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${response.status}: ${JSON.stringify(payload)}`);
  return payload;
}

async function getJson(url: string, token?: string): Promise<any> {
  const response = await fetch(url, { headers: headers(token) });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${response.status}: ${JSON.stringify(payload)}`);
  return payload;
}

function parsePlan(prompt?: string): BuildPlan | null {
  if (!prompt) return null;
  const prefix = 'LUA_X_PLAN:';
  if (!prompt.startsWith(prefix)) return null;
  try {
    const value = JSON.parse(prompt.slice(prefix.length)) as BuildPlan;
    return value && typeof value === 'object' ? value : null;
  } catch {
    return null;
  }
}

export function createBridge(studioId?: string) {
  const transport = new StdioMcpTransport({ ...(studioId ? { studioId } : {}) });
  return new RobloxMcpBridge({ transport, requireConfirmation: true });
}

export async function pollAndBridge(config: ProxyConfig): Promise<void> {
  const bridge = createBridge(config.studioId);
  const agent = new AgentRuntime(bridge, {
    maxRepairAttempts: 1,
    onEvent: async (event) => console.log(`[lua-x:${event.role}] ${event.message}`),
  });
  const tokenHeaders = headers(config.token);
  const apiBase = config.apiBase.replace(/\/$/, '');
  let sessionId: string | null = null;
  let running = false;

  try {
    await bridge.connect();
    const studios = await bridge.listStudios();
    console.log(`[lua-x] native Roblox Studio MCP connected; discovered ${Array.isArray(studios.data) ? studios.data.length : 'available'} studio record(s)`);
  } catch (error) {
    console.error('[lua-x] MCP connection failed:', error instanceof Error ? error.message : error);
    throw error;
  }

  async function registerOrRefresh(): Promise<void> {
    try {
      if (!sessionId) {
        const pending = await getJson(`${apiBase}/api/studio/connect/pending`, config.token);
        const request = pending.request;
        if (request) {
          const proxyId = `agent-${process.pid}-${Date.now().toString(36)}`;
          const reg = await postJson(`${apiBase}/api/studio/register`, {
            projectId: request.projectId || config.projectId || 'lua-x-local',
            sessionId: proxyId,
            placeName: 'Roblox Studio (native MCP)',
            pluginVersion: 'native-mcp',
            capabilities: ['mcp-native', 'agent', 'sync', 'playtest', 'assets', 'vision'],
            clientId: proxyId,
            requestId: request.requestId,
          }, config.token);
          sessionId = reg.sessionId || proxyId;
          console.log(`[lua-x] claimed Studio connection request ${request.requestId}`);
        } else {
          const status = await getJson(`${apiBase}/api/studio/status?projectId=${encodeURIComponent(config.projectId || 'lua-x-local')}`, config.token);
          if (status.connected) sessionId = status.sessionId;
        }
      }
      if (sessionId) {
        const state = await bridge.studioState(true);
        const place = state.data && typeof state.data === 'object' ? state.data as Record<string, unknown> : {};
        await postJson(`${apiBase}/api/studio/heartbeat`, {
          sessionId,
          projectId: config.projectId || String(place.placeId || 'lua-x-local'),
          placeName: String(place.name || 'Roblox Studio'),
          placeId: place.placeId,
          pluginVersion: 'native-mcp',
          capabilities: ['mcp-native', 'agent', 'sync', 'playtest', 'assets', 'vision'],
          context: { selection: 0, scripts: 0 },
        }, config.token);
      }
    } catch (error) {
      console.error('[lua-x] registration/heartbeat failed:', error instanceof Error ? error.message : error);
    }
  }

  async function consume(): Promise<void> {
    if (!sessionId || running) return;
    let command: { type: string; prompt?: string } | undefined;
    try {
      const result = await getJson(`${apiBase}/api/studio/command?sessionId=${encodeURIComponent(sessionId)}`, config.token);
      command = result.command;
    } catch (error) {
      console.error('[lua-x] command poll failed:', error instanceof Error ? error.message : error);
      return;
    }
    if (!command) return;
    running = true;
    console.log(`[lua-x] executing ${command.type}`);
    try {
      let results: unknown[] = [];
      let success = 1;
      let failed = 0;
      if (command.type === 'ping') {
        const state = await bridge.studioState(true);
        results = [state.data ?? state.raw ?? state];
        success = state.ok ? 1 : 0;
        failed = state.ok ? 0 : 1;
      } else if (command.type === 'refresh_context') {
        const inspection = await agent.inspect();
        results = [inspection.studios.data, inspection.tree.data, inspection.console.data];
        if (sessionId) await postJson(`${apiBase}/api/studio/context`, { sessionId, context: { ...inspection.tree.data && { workspaceTree: inspection.tree.data }, ...inspection.console.data && { console: inspection.console.data } } }, config.token);
      } else if (command.type === 'build' || command.type === 'apply') {
        const plan = parsePlan(command.prompt);
        if (!plan) throw new Error('Build command did not contain an appliable LUA-X plan. Generate a plan in the web workspace, then click Apply via MCP.');
        const result = await agent.executePlan(plan, config.studioId);
        results = result.results;
        success = result.ok ? 1 : 0;
        failed = result.failed;
      } else if (command.type === 'verify') {
        const state = await bridge.studioState(true);
        const console = await bridge.consoleOutput();
        results = [state.data ?? state.raw ?? state, console.data ?? console.raw ?? console];
        success = state.ok && console.ok ? 1 : 0;
        failed = success ? 0 : 1;
      } else if (command.type === 'stop') {
        const result = await bridge.play('stop', true, config.studioId);
        results = [result.data ?? result.raw ?? result];
        success = result.ok ? 1 : 0;
        failed = result.ok ? 0 : 1;
      } else if (command.type === 'analyze') {
        const inspection = await agent.inspect();
        results = [inspection.studios.data, inspection.tree.data, inspection.console.data];
        success = 1;
        failed = 0;
      } else {
        throw new Error(`Unsupported command ${command.type}`);
      }
      await postJson(`${apiBase}/api/studio/apply`, {
        sessionId,
        planSummary: `native-mcp:${command.type}`,
        success,
        failed,
        results: results.map((value) => JSON.stringify(value).slice(0, 500)),
      }, config.token);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('[lua-x] execution failed:', message);
      await postJson(`${apiBase}/api/studio/apply`, {
        sessionId,
        planSummary: `native-mcp:${command.type}`,
        success: 0,
        failed: 1,
        results: [message],
      }, config.token).catch(() => undefined);
    } finally {
      running = false;
    }
  }

  await registerOrRefresh();
  setInterval(() => { void registerOrRefresh(); }, 4000);
  setInterval(() => { void consume(); }, config.pollMs ?? 1200);
  await consume();
}
