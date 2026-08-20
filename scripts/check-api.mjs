import { build } from 'esbuild';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url)).replace(/[\\/]$/, '');
const apiDir = join(root, 'api');

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.name.endsWith('.ts')) out.push(full);
  }
  return out;
}

const files = walk(apiDir);
if (files.length === 0) {
  console.error('check:api: no .ts files found under api/');
  process.exit(1);
}

try {
  await build({
    entryPoints: files,
    bundle: true,
    platform: 'node',
    format: 'esm',
    logLevel: 'silent',
    outdir: join(root, 'node_modules', '.cache', 'api-check'),
    write: false,
  });
  console.log(`check:api: parsed ${files.length} file(s) under api/ OK`);
} catch (error) {
  console.error('check:api FAILED — syntax/import error in api/:');
  console.error(error.message);
  process.exit(1);
}