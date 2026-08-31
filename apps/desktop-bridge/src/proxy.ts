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

async function postJson(url: string, body: unknown, token?: string): Promise<Record<string, unknown>> {
  const response = await fetch(url, { method: 'POST', headers: headers(token), body: JSON.stringify(body) });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${response.status}: ${JSON.stringify(payload)}`);
  return payload as Record<string, unknown>;
}

async function getJson(url: string, token?: string): Promise<Record<string, unknown>> {
  const response = await fetch(url, { headers: headers(token) });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${response.status}: ${JSON.stringify(payload)}`);
  return payload as Record<string, unknown>;
}

function parsePlan(prompt?: string): BuildPlan | null {
  if (!prompt?.startsWith('LUA_X_PLAN:')) return null;
  try {
    const value = JSON.parse(prompt.slice('LUA_X_PLAN:'.length)) as BuildPlan;
    return value && typeof value === 'object' ? value : null;
  } catch {
    return null;
  }
}

export function createBridge(studioId?: string) {
  const transport = new StdioMcpTransport({
    ...(studioId ? { studioId } : {}),
    requestTimeoutMs: 30000,
    toolDiscoveryAttempts: 12,
    toolDiscoveryDelayMs: 1000,
  });
  return new RobloxMcpBridge({ transport, requireConfirmation: true });
}

export async function pollAndBridge(config: ProxyConfig): Promise<void> {
  const bridge = createBridge(config.studioId);
  const agent = new AgentRuntime(bridge, {
    maxRepairAttempts: 2,
    onEvent: async (event) => console.log(`[lua-x:${event.role}] ${event.message}`),
  });
  const apiBase = config.apiBase.replace(/\/$/, '');
  let sessionId: string | null = null;
  let running = false;
  const clientId = `agent-${process.pid}-${Date.now().toString(36)}`;

  await bridge.connect();
  const discovered = await bridge.listTools();
  console.log(`[lua-x] native Roblox MCP connected; ${discovered.length} tools discovered.`);

  async function registerOrRefresh(): Promise<void> {
    try {
      const state = await bridge.studioState(true);
      const place = state.data && typeof state.data === 'object' ? state.data as Record<string, unknown> : {};

      if (!sessionId) {
        const pending = await getJson(`${apiBase}/api/studio/connect/pending`, config.token).catch(() => ({ request: null }));
        const request = pending.request as { requestId?: string; projectId?: string } | null;
        const projectId = request?.projectId || config.projectId || String(place.placeId || 'lua-x-local');
        const reg = await postJson(`${apiBase}/api/studio/register`, {
          projectId,
          sessionId: clientId,
          placeName: String(place.name || 'Roblox Studio'),
          ...(place.placeId ? { placeId: String(place.placeId) } : {}),
          pluginVersion: '2.2.0',
          capabilities: ['mcp-native', 'agent', 'sync', 'playtest', 'assets', 'vision'],
          clientId,
          ...(request?.requestId ? { requestId: request.requestId } : {}),
        }, config.token);
        sessionId = typeof reg.sessionId === 'string' ? reg.sessionId : clientId;
        console.log(`[lua-x] Studio session registered: ${sessionId}`);
      }

      if (!sessionId) return;
      await postJson(`${apiBase}/api/studio/heartbeat`, {
        sessionId,
        projectId: config.projectId || String(place.placeId || 'lua-x-local'),
        placeName: String(place.name || 'Roblox Studio'),
        ...(place.placeId ? { placeId: String(place.placeId) } : {}),
        pluginVersion: '2.2.0',
        capabilities: ['mcp-native', 'agent', 'sync', 'playtest', 'assets', 'vision'],
        clientId,
        context: { selection: 0, scripts: 0 },
      }, config.token);
    } catch (error) {
      console.error('[lua-x] registration/heartbeat failed:', error instanceof Error ? error.message : error);
      sessionId = null;
    }
  }

  async function consume(): Promise<void> {
    if (!sessionId || running) return;
    let command: { type?: string; prompt?: string } | undefined;
    try {
      const result = await getJson(`${apiBase}/api/studio/command?sessionId=${encodeURIComponent(sessionId)}`, config.token);
      command = result.command as { type?: string; prompt?: string } | undefined;
    } catch (error) {
      console.error('[lua-x] command poll failed:', error instanceof Error ? error.message : error);
      return;
    }
    if (!command?.type) return;
    running = true;
    console.log(`[lua-x] executing ${command.type}`);
    try {
      let results: unknown[] = [];
      let success = 1;
      let failed = 0;
      switch (command.type) {
        case 'ping': {
          const result = await bridge.studioState(true);
          results = [result.data ?? result.raw ?? result];
          success = result.ok ? 1 : 0;
          failed = result.ok ? 0 : 1;
          break;
        }
        case 'refresh_context': {
          const inspection = await agent.inspect();
          results = [inspection.studios.data, inspection.tree.data, inspection.console.data];
          await postJson(`${apiBase}/api/studio/context`, {
            sessionId,
            context: {
              workspaceTree: inspection.tree.data,
              console: inspection.console.data,
              studios: inspection.studios.data,
            },
          }, config.token);
          break;
        }
        case 'build':
        case 'apply': {
          const plan = parsePlan(command.prompt);
          if (!plan) throw new Error('No executable LUA-X plan found. Generate a plan in the web workspace first.');
          const result = await agent.executePlan(plan, config.studioId);
          results = result.results;
          success = result.ok ? 1 : 0;
          failed = result.failed;
          break;
        }
        case 'verify': {
          const state = await bridge.studioState(true);
          const console = await bridge.consoleOutput();
          results = [state.data ?? state.raw ?? state, console.data ?? console.raw ?? console];
          success = state.ok && console.ok ? 1 : 0;
          failed = success ? 0 : 1;
          break;
        }
        case 'stop': {
          const result = await bridge.play('stop', true, config.studioId);
          results = [result.data ?? result.raw ?? result];
          success = result.ok ? 1 : 0;
          failed = result.ok ? 0 : 1;
          break;
        }
        case 'analyze': {
          const inspection = await agent.inspect();
          results = [inspection.studios.data, inspection.tree.data, inspection.console.data];
          break;
        }
        default:
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
  setInterval(() => { void consume(); }, Math.max(500, config.pollMs ?? 1000));
  await consume();
}
