import { createServer, type IncomingMessage, type ServerResponse, request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HOST = process.env.HOST ?? '127.0.0.1';
const PORT = Number(process.env.PORT ?? 3000);
const API_BASE = (process.env.LUA_X_API_URL ?? (process.env.VERCEL ? 'https://lua-x-api.vercel.app' : 'http://127.0.0.1:4000')).replace(/\/$/, '');
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
  request.on('error', () => {
    setCorsHeaders(response);
    sendJson(response, 502, { error: 'API server unreachable.', detail: `Could not connect to ${API_BASE}` });
  });
  request.on('end', () => {
    const body = Buffer.concat(chunks);
    const headers: Record<string, string | string[]> = {};
    for (const [key, value] of Object.entries(request.headers)) {
      if (key === 'host') continue;
      if (typeof value === 'string') headers[key] = value;
      else if (Array.isArray(value)) headers[key] = value;
    }

    let parsed: URL;
    try {
      parsed = new URL(API_BASE);
    } catch {
      setCorsHeaders(response);
      sendJson(response, 502, { error: 'API server unreachable.', detail: `Invalid API base URL: ${API_BASE}` });
      return;
    }
    const isHttps = parsed.protocol === 'https:';
    const transport = isHttps ? httpsRequest : httpRequest;
    const proxyReq = transport({
      hostname: parsed.hostname,
      port: parsed.port ? Number(parsed.port) : isHttps ? 443 : 80,
      path: request.url,
      method: request.method,
      headers,
    }, (proxyRes: IncomingMessage) => {
      setCorsHeaders(response);
      // Merge CORS and strip hop-by-hop that shouldn't be forwarded
      const outHeaders: Record<string, string> = {};
      for (const [k, v] of Object.entries(proxyRes.headers)) {
        if (!v) continue;
        const val = Array.isArray(v) ? v.join(', ') : (v as string);
        // Skip headers we'll set ourselves
        if (k.toLowerCase() === 'access-control-allow-origin') continue;
        if (k.toLowerCase() === 'access-control-allow-methods') continue;
        if (k.toLowerCase() === 'access-control-allow-headers') continue;
        outHeaders[k] = val;
      }
      setCorsHeaders(response);
      response.writeHead(proxyRes.statusCode ?? 502, outHeaders);
      proxyRes.pipe(response);
    });

    proxyReq.on('error', (err) => {
      console.error(`[web-proxy] failed to proxy ${request.url} to ${API_BASE}:`, err);
      if (!response.headersSent) {
        setCorsHeaders(response);
        sendJson(response, 502, { error: 'API server unreachable.', detail: `Could not connect to ${API_BASE}` });
      }
    });

    proxyReq.setTimeout(15000, () => {
      proxyReq.destroy(new Error('Proxy timeout'));
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

  // Web health - only at /health and /web/health, NOT /api/health (which proxies to API)
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

  // Also handle /api/health via proxy for diagnostics, but expose web health separately
  if (method === 'GET' && url.pathname === '/api/health' && url.searchParams.has('web')) {
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

  setCorsHeaders(response);
  sendJson(response, 404, { error: 'Not found.' });
});

if (process.env.NODE_ENV !== 'test') {
  server.listen(PORT, HOST, () => console.log(`LUA-X web listening on http://${HOST}:${PORT} (API proxy → ${API_BASE})`));
}
