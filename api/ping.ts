export default async function handler(request: Request): Promise<Response> {
  return new Response(JSON.stringify({ ok: true, route: 'ping' }), {
    status: 200,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}