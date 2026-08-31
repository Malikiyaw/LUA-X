import { createServer, type IncomingMessage, type ServerResponse, request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HOST = process.env.HOST ?? '127.0.0.1';
const PORT = Number(process.env.PORT ?? 3000);
const API_BASE = (process.env.LUA_X_API_URL ?? (process.env.VERCEL ? 'https://lua-x-api.vercel.app' : 'http://127.0.0.1:4000')).replace(/\/+$/, '');
const VERSION = '0.11.0-alpha';
const PROXY_TIMEOUT_MS = 90000;
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

function setCorsHeaders(response: ServerResponse): void {
  response.setHeader('access-control-allow-origin', '*');
  response.setHeader('access-control-allow-methods', 'GET,POST,OPTIONS');
  response.setHeader('access-control-allow-headers', 'content-type,authorization,x-request-id');
}

async function serveStatic(pathname: string, response: ServerResponse): Promise<boolean> {
  const requested = pathname === '/' ? '/index.html' : pathname;
  const relative = requested.replace(/^\/+/, '');
  if (!relative || relative.includes('..')) return false;

  try {
    const file = await readFile(join(PUBLIC_DIR, relative));
    const extension = relative.includes('.') ? `.${relative.split('.').pop()}` : '';
    const isPluginDownload = relative === 'LUA-X.lua' || relative === 'download/LUA-X.lua';
    const headers: Record<string, string> = {
      'content-type': isPluginDownload ? 'text/plain; charset=utf-8' : (CONTENT_TYPES[extension] ?? 'application/octet-stream'),
      'cache-control': isPluginDownload ? 'no-store' : (relative === 'index.html' ? 'no-cache' : 'public, max-age=3600'),
    };
    if (isPluginDownload) {
      headers['content-disposition'] = 'attachment; filename="LUA-X.lua"';
      headers['x-content-type-options'] = 'nosniff';
    }
    response.writeHead(200, headers);
    response.end(file);
    return true;
  } catch {
    return false;
  }
}

function proxyToApi(request: IncomingMessage, response: ServerResponse): void {
  const chunks: Buffer[] = [];
  request.on('data', (chunk: Buffer) => chunks.push(chunk));
  request.on('end', () => {
    const body = Buffer.concat(chunks);
    const headers: Record<string, string | string[]> = {};
    for (const [key, value] of Object.entries(request.headers)) {
      if (key === 'host' || key === 'connection') continue;
      if (typeof value === 'string') headers[key] = value;
      else if (Array.isArray(value)) headers[key] = value;
    }

    let parsed: URL;
    try {
      parsed = new URL(API_BASE);
    } catch {
      setCorsHeaders(response);
      sendJson(response, 502, { error: 'Invalid API base URL.', detail: API_BASE });
      return;
    }
    const transport = parsed.protocol === 'https:' ? httpsRequest : httpRequest;
    const proxyReq = transport({
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: request.url,
      method: request.method,
      headers,
    }, (proxyRes: IncomingMessage) => {
      const outHeaders: Record<string, string | string[]> = {};
      for (const [key, value] of Object.entries(proxyRes.headers)) {
        if (key.startsWith('access-control-')) continue;
        outHeaders[key] = value as string | string[];
      }
      setCorsHeaders(response);
      response.writeHead(proxyRes.statusCode ?? 502, outHeaders);
      proxyRes.pipe(response);
    });

    proxyReq.setTimeout(PROXY_TIMEOUT_MS, () => proxyReq.destroy(new Error(`API proxy timed out after ${PROXY_TIMEOUT_MS}ms.`)));
    proxyReq.on('error', (error) => {
      setCorsHeaders(response);
      sendJson(response, 502, { error: 'API server unreachable.', detail: `Could not connect to ${API_BASE} — ${error.message}` });
    });

    if (body.length > 0) proxyReq.write(body);
    proxyReq.end();
  });
}

function isApiRoute(pathname: string): boolean {
  return pathname.startsWith('/api/') || pathname === '/api';
}

export const server = createServer(async (request: IncomingMessage, response: ServerResponse) => {
  const method = request.method ?? 'GET';
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? `${HOST}:${PORT}`}`);

  if (method === 'OPTIONS') {
    setCorsHeaders(response);
    response.writeHead(204);
    response.end();
    return;
  }

  if (method === 'GET' && (url.pathname === '/health' || url.pathname === '/web/health')) {
    sendJson(response, 200, {
      service: 'lua-x-web',
      status: 'ok',
      version: VERSION,
      apiBase: API_BASE || null,
    });
    return;
  }

  if (method === 'GET' && url.pathname === '/api/config') {
    setCorsHeaders(response);
    sendJson(response, 200, { apiBase: API_BASE, version: VERSION });
    return;
  }

  if (method === 'GET' && url.pathname === '/api/health' && url.searchParams.has('web')) {
    setCorsHeaders(response);
    sendJson(response, 200, {
      service: 'lua-x-web',
      status: 'ok',
      version: VERSION,
      apiBase: API_BASE || null,
    });
    return;
  }

  if (isApiRoute(url.pathname)) {
    proxyToApi(request, response);
    return;
  }

  if (method === 'GET') {
    if (await serveStatic(url.pathname, response)) return;
  }

  sendJson(response, 404, { error: 'Not found.' });
});

if (process.env.NODE_ENV !== 'test') {
  server.listen(PORT, HOST, () => console.log(`LUA-X web listening on http://${HOST}:${PORT} (API proxy → ${API_BASE})`));
}
