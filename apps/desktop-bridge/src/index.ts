#!/usr/bin/env node
import { pollAndBridge } from './proxy.js';
import { createBridge } from './proxy.js';

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  return fallback && process.env[name.toUpperCase()] ? process.env[name.toUpperCase()] : fallback;
}

const apiBase = arg('api', process.env.LUA_X_API_URL ?? 'https://lua-x-api.vercel.app')!;
const token = arg('token', process.env.LUA_X_API_TOKEN);
const studioId = arg('studioId');
const projectId = arg('projectId', process.env.LUA_X_PROJECT_ID ?? 'lua-x-local');

async function main(): Promise<void> {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    console.log(`LUA-X local agent\n\nUsage:\n  lua-x --api https://lua-x-api.vercel.app --token <TOKEN> [--studioId <ID>] [--projectId <ID>]\n  lua-x --check-mcp\n\nThe agent connects to Roblox Studio's native MCP server over stdio.\nEnable it in Studio: Assistant → … → Manage MCP Servers → Enable Studio as MCP server.`);
    return;
  }

  if (process.argv.includes('--check-mcp')) {
    const bridge = createBridge(studioId);
    try {
      await bridge.connect();
      const tools = await bridge.listTools();
      const studios = await bridge.listStudios();
      console.log(JSON.stringify({ ok: true, transport: 'stdio', toolCount: tools.length, tools: tools.map((tool) => tool.name), studios: studios.data ?? studios.raw ?? studios }, null, 2));
    } catch (error) {
      console.error(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }, null, 2));
      process.exitCode = 1;
    } finally {
      await bridge.close?.();
    }
    return;
  }

  console.log(`[lua-x] starting local agent → ${apiBase}`);
  console.log('[lua-x] expected Studio setup: Assistant → … → Manage MCP Servers → Enable Studio as MCP server');
  await pollAndBridge({ apiBase, ...(token ? { token } : {}), ...(studioId ? { studioId } : {}), ...(projectId ? { projectId } : {}) });
}

void main().catch((error) => {
  console.error('[lua-x] fatal:', error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});
