import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileExecutionBrief } from '@lua-x/orchestrator';
import { healthStatus, VERSION } from '@lua-x/shared';

const HOST = process.env.HOST ?? '127.0.0.1';
const PORT = Number(process.env.PORT ?? 3000);
const API_BASE = process.env.LUA_X_API_URL ?? '';
const PUBLIC_DIR = join(dirname(fileURLToPath(import.meta.url)), '../public');

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

function sendJson(response: ServerResponse, status: number, payload: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  response.end(JSON.stringify(payload));
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk);
    size += buffer.byteLength;
    if (size > 64 * 1024) throw new Error('Request body is too large.');
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function serveStatic(pathname: string, response: ServerResponse): Promise<boolean> {
  const requested = pathname === '/' ? '/index.html' : pathname;
  const relative = requested.replace(/^\/+/, '');
  if (relative.includes('..')) return false;
  try {
    const file = await readFile(join(PUBLIC_DIR, relative));
    const ext = relative.includes('.') ? `.${relative.split('.').pop()}` : '';
    response.writeHead(200, { 'content-type': CONTENT_TYPES[ext] ?? 'application/octet-stream', 'cache-control': relative === 'index.html' ? 'no-cache' : 'public, max-age=3600' });
    response.end(file);
    return true;
  } catch {
    return false;
  }
}

export const server = createServer(async (request, response) => {
  const method = request.method ?? 'GET';
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? `${HOST}:${PORT}`}`);

  if (method === 'OPTIONS') {
    response.writeHead(204, { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET,POST,OPTIONS', 'access-control-allow-headers': 'content-type' });
    response.end();
    return;
  }

  if (method === 'GET' && url.pathname === '/health') {
    sendJson(response, 200, { ...healthStatus(), version: VERSION, apiBase: API_BASE || null });
    return;
  }

  if (method === 'GET' && url.pathname === '/api/config') {
    sendJson(response, 200, { apiBase: API_BASE || '' });
    return;
  }

  if (method === 'POST' && url.pathname === '/api/plan') {
    try {
      const payload: unknown = JSON.parse(await readBody(request));
      if (!payload || typeof payload !== 'object' || !('prompt' in payload) || typeof payload.prompt !== 'string') {
        sendJson(response, 400, { error: 'Request must contain a string prompt.' });
        return;
      }
      const brief = compileExecutionBrief({ prompt: payload.prompt });
      sendJson(response, 200, { version: VERSION, brief });
    } catch (error) {
      sendJson(response, 400, { error: error instanceof Error ? error.message : 'Invalid request.' });
    }
    return;
  }

  if (method === 'GET') {
    const served = await serveStatic(url.pathname, response);
    if (served) return;
  }

  sendJson(response, 404, { error: 'Not found.' });
});

if (process.env.NODE_ENV !== 'test') {
  server.listen(PORT, HOST, () => console.log(`LUA-X web listening on http://${HOST}:${PORT}`));
}
