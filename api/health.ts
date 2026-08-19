export const config = { runtime: 'nodejs' };

export default function handler(request: { method?: string }): Response {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response(JSON.stringify({ error: 'Method not allowed.' }), {
      status: 405,
      headers: { 'content-type': 'application/json; charset=utf-8', allow: 'GET, HEAD' },
    });
  }
  return new Response(JSON.stringify({
    service: 'lua-x-api',
    status: 'ok',
    version: '1.2.0',
    bridge: 'studio-v1',
  }), {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'access-control-allow-origin': '*',
    },
  });
}
