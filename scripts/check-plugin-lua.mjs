#!/usr/bin/env node
// Syntax gate for the canonical Studio plugin source.
// Roblox Studio silently hides plugins that throw at load time, so a single
// syntax error makes LUA-X invisible in the Plugins tab with zero feedback.
// This gate parses studio-plugin/LUA-X-connected.lua with luaparse before it
// can ship (wired into `npm run sync:check`).
//
// Note: luaparse targets Lua 5.x/LuaJIT. The plugin intentionally avoids
// Luau-only syntax (type annotations, compound assignment, `continue`) so this
// parse stays a reliable whole-file guarantee.

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pluginPath = resolve(root, 'studio-plugin', 'LUA-X-connected.lua');
const checkOnly = process.argv.includes('--check');

let luaparse;
try {
  const require_ = createRequire(import.meta.url);
  luaparse = require_('luaparse');
} catch {
  console.error('[check:plugin-lua] luaparse is not installed — run `npm install`.');
  process.exit(1);
}

let source;
try {
  source = readFileSync(pluginPath, 'utf8');
} catch {
  console.error(`[check:plugin-lua] canonical plugin missing: ${pluginPath}`);
  process.exit(1);
}

// Version marker sanity: the installer verifies the same marker after copying.
if (!/^-- LUA-X Studio Plugin \d+\.\d+\.\d+/m.test(source)) {
  console.error('[check:plugin-lua] FAIL: missing "-- LUA-X Studio Plugin <version>" header marker.');
  process.exit(1);
}

// Guard the two historical failure modes forever:
if (/GetService\(\s*["']ClipboardService["']\s*\)/.test(source)) {
  console.error('[check:plugin-lua] FAIL: ClipboardService does not exist in Roblox — a bare GetService here crashes plugin load.');
  process.exit(1);
}

const earlyWiring = source.indexOf('plugin.ActionTriggered:Connect');
const buildWidgetDef = source.indexOf('local function buildWidget');
if (earlyWiring !== -1 && buildWidgetDef !== -1 && earlyWiring < buildWidgetDef) {
  console.error('[check:plugin-lua] FAIL: ActionTriggered wired before buildWidget is declared (forward-reference bug regression).');
  process.exit(1);
}

try {
  luaparse.parse(source, { luaVersion: 'LuaJIT' });
} catch (error) {
  console.error(`[check:plugin-lua] FAIL: ${error.message}`);
  process.exit(1);
}

console.log('[check:plugin-lua] OK — plugin parses cleanly, no known load-crash patterns.');
