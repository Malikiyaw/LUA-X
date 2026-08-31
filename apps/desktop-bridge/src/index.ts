#!/usr/bin/env node
import { pollAndBridge } from './proxy.js';

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  if (fallback && process.env[name.toUpperCase()]) return process.env[name.toUpperCase()];
  return fallback;
}

const apiBase = arg('api', process.env.LUA_X_API_URL ?? 'https://lua-x-api.vercel.app')!;
const token = arg('token', process.env.LUA_X_API_TOKEN);
const studioId = arg('studioId', undefined);

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(`lua-x desktop bridge
Usage: lua-x --api https://lua-x-api.vercel.app --token <LUA_X_API_TOKEN> [--studioId <id>]
Env: LUA_X_API_URL, LUA_X_API_TOKEN
Runs: polls /api/studio/command and forwards to local Studio MCP via stdio (mcp.bat/StudioMCP)`);
  process.exit(0);
}

console.log(`[lua-x] bridging ${apiBase} ${studioId ? `(studio ${studioId})` : ''} token ${token ? 'yes' : 'no (anonymous)'}...`);
pollAndBridge({ apiBase, ...(token ? { token } : {}), ...(studioId ? { studioId } : {}) });
