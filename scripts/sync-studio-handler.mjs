#!/usr/bin/env node
// Synchronizes the canonical Studio handler into the Vercel function directory.
// The Vercel function must be self-contained in api/ (no monorepo cross-workspace
// imports) so the deployment bundler never has to trace ../../apps/api/src/...
// Usage: node scripts/sync-studio-handler.mjs [--check]
//   default: copy canonical source -> api/studio-handler.ts
//   --check: exit non-zero if the copy is stale (drift guard)

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const canonical = resolve(root, 'apps/api/src/studio-handler.ts');
const target = resolve(root, 'api/studio-handler.ts');
const checkOnly = process.argv.includes('--check');

if (!existsSync(canonical)) {
  console.error(`[sync-studio-handler] canonical source missing: ${canonical}`);
  process.exit(1);
}

const source = readFileSync(canonical, 'utf8');
if (checkOnly) {
  if (!existsSync(target) || readFileSync(target, 'utf8') !== source) {
    console.error('[sync-studio-handler] api/studio-handler.ts is stale. Run `npm run sync:studio-handler` and commit the result.');
    process.exit(1);
  }
  console.log('[sync-studio-handler] api/studio-handler.ts is in sync.');
  process.exit(0);
}

writeFileSync(target, source);
console.log(`[sync-studio-handler] api/studio-handler.ts synchronized (${Buffer.byteLength(source)} bytes).`);