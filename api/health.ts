export const config = { runtime: 'nodejs' };

export function GET(): Response {
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

export function OPTIONS(): Response {
  return new Response(null, {
    status: 204,
    headers: {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET,OPTIONS',
      'access-control-allow-headers': 'content-type,authorization,x-request-id',
    },
  });
}