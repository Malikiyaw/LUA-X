const DEFAULT_MODEL = 'nvidia/llama-3.3-nemotron-super-49b-v1.5';

function configuredKeys(): string[] {
  return [
    process.env.NVIDIA_API_KEY,
    process.env.NVIDIA_API_KEY_1,
    process.env.NVIDIA_API_KEY_2,
    process.env.NVIDIA_API_KEY_3,
    process.env.NVIDIA_API_KEY_4,
  ].map((value) => value?.trim()).filter((value): value is string => Boolean(value));
}

export default function handler(request: Request): Response {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { 'access-control-allow-origin': '*' } });
  if (request.method !== 'GET') return new Response(JSON.stringify({ error: 'Method not allowed.' }), { status: 405, headers: { 'content-type': 'application/json', allow: 'GET, OPTIONS' } });
  const keyCount = new Set(configuredKeys()).size;
  const model = process.env.NVIDIA_MODEL?.trim() || DEFAULT_MODEL;
  return new Response(JSON.stringify({
    provider: 'nvidia',
    configured: keyCount > 0,
    keyPoolSize: keyCount,
    model,
    resilient: true,
  }), {
    status: 200,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'access-control-allow-origin': '*' },
  });
}
