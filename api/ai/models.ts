export const config = { runtime: 'nodejs' };

const BASE = 'https://integrate.api.nvidia.com/v1';
const CANDIDATES = [
  'meta/llama-3.3-70b-instruct',
  'openai/gpt-oss-120b',
  'openai/gpt-oss-20b',
  'deepseek-ai/deepseek-v4-flash',
  'moonshotai/kimi-k3',
  'qwen/qwen3-next-80b-a3b-instruct',
  'mistralai/mistral-nemotron',
  'nvidia/llama-3.1-nemotron-70b-instruct',
  'nvidia/llama-3.1-nemotron-nano-8b-v1',
  'meta/llama-3.1-8b-instruct',
  'meta/llama-3.2-3b-instruct',
  'nvidia/llama-3.1-nemotron-ultra-253b-v1',
  'nvidia/llama-3.3-nemotron-super-49b-v1.5',
  'nvidia/llama-3.3-nemotron-super-49b-v1',
  'nvidia/mistral-nemo-12b-instruct',
  'qwen/qwen2.5-72b-instruct',
  'deepseek-ai/deepseek-r1',
];

function keys(): string[] {
  const values = [
    process.env.NVIDIA_API_KEY,
    process.env.NVIDIA_API_KEY_1,
    process.env.NVIDIA_API_KEY_2,
    process.env.NVIDIA_API_KEY_3,
    process.env.NVIDIA_API_KEY_4,
  ].map((value) => value?.trim()).filter((value): value is string => Boolean(value));
  return [...new Set(values)];
}

export async function GET(): Promise<Response> {
  const apiKeys = keys();
  if (!apiKeys.length) {
    return new Response(JSON.stringify({ error: 'No NVIDIA keys configured.' }), {
      status: 503,
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'access-control-allow-origin': '*' },
    });
  }

  const results: Array<{ model: string; status: number | string; ms: number }> = [];
  for (const model of CANDIDATES) {
    const started = Date.now();
    try {
      const response = await fetch(`${BASE}/chat/completions`, {
        method: 'POST',
        headers: { authorization: `Bearer ${apiKeys[0]}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: 'Reply with the single word: ok' }],
          max_tokens: 16,
          temperature: 0,
          stream: false,
        }),
        signal: AbortSignal.timeout(20000),
      });
      results.push({ model, status: response.status, ms: Date.now() - started });
    } catch (error) {
      results.push({ model, status: error instanceof Error ? error.message : 'failed', ms: Date.now() - started });
    }
  }

  return new Response(JSON.stringify({ results }, null, 2), {
    status: 200,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'access-control-allow-origin': '*' },
  });
}