import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HOST = process.env.HOST ?? '127.0.0.1';
const PORT = Number(process.env.PORT ?? 3000);
const API_BASE = process.env.LUA_X_API_URL ?? '';
const VERSION = '0.11.0-alpha';
const PUBLIC_DIR = join(dirname(fileURLToPath(import.meta.url)), '../public');

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.lua': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
};

function sendJson(response: ServerResponse, status: number, payload: unknown): void {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  response.end(JSON.stringify(payload));
}

async function serveStatic(pathname: string, response: ServerResponse): Promise<boolean> {
  const requested = pathname === '/' ? '/index.html' : pathname;
  const relative = requested.replace(/^\/+/, '');
  if (!relative || relative.includes('..')) return false;

  try {
    const file = await readFile(join(PUBLIC_DIR, relative));
    const extension = relative.includes('.') ? `.${relative.split('.').pop()}` : '';
    const isPluginDownload = relative === 'LUA-X.plugin.lua' || relative === 'download/LUA-X.plugin.lua';
    const headers: Record<string, string> = {
      'content-type': isPluginDownload ? 'text/plain; charset=utf-8' : (CONTENT_TYPES[extension] ?? 'application/octet-stream'),
      'cache-control': isPluginDownload ? 'no-store' : (relative === 'index.html' ? 'no-cache' : 'public, max-age=3600'),
    };
    if (isPluginDownload) {
      headers['content-disposition'] = 'attachment; filename="LUA-X.plugin.lua"';
      headers['x-content-type-options'] = 'nosniff';
    }
    response.writeHead(200, headers);
    response.end(file);
    return true;
  } catch {
    return false;
  }
}

export const server = createServer(async (request: IncomingMessage, response: ServerResponse) => {
  const method = request.method ?? 'GET';
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? `${HOST}:${PORT}`}`);

  if (method === 'OPTIONS') {
    response.writeHead(204, {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET,OPTIONS',
      'access-control-allow-headers': 'content-type',
    });
    response.end();
    return;
  }

  if (method === 'GET' && (url.pathname === '/health' || url.pathname === '/api/health')) {
    sendJson(response, 200, {
      service: 'lua-x-web',
      status: 'ok',
      version: VERSION,
      apiBase: API_BASE || null,
    });
    return;
  }

  if (method === 'GET' && url.pathname === '/api/config') {
    sendJson(response, 200, { apiBase: API_BASE });
    return;
  }

  if (method === 'GET') {
    if (await serveStatic(url.pathname, response)) return;
  }

  sendJson(response, 404, { error: 'Not found.' });
});

if (process.env.NODE_ENV !== 'test') {
  server.listen(PORT, HOST, () => console.log(`LUA-X web listening on http://${HOST}:${PORT}`));
}
