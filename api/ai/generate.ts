type Change = {
  operation: 'create_script' | 'update_script' | 'create_instance' | 'update_instance' | 'delete_instance' | 'note';
  target: string;
  reason: string;
  risk: 'low' | 'medium' | 'high' | 'critical';
  content?: string;
};

type Plan = {
  summary: string;
  assumptions: string[];
  changes: Change[];
  acceptanceCriteria: string[];
  verification: string[];
  risks: string[];
};

const DEFAULT_BASE = 'https://integrate.api.nvidia.com/v1';
const DEFAULT_MODELS = [
  'nvidia/llama-3.3-nemotron-super-49b-v1.5',
  'nvidia/llama-3.3-nemotron-super-49b-v1',
];
const MAX_BODY = 64 * 1024;
const MAX_ATTEMPTS_PER_PAIR = 2;

function json(status: number, payload: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'access-control-allow-origin': '*', ...headers },
  });
}

function requestId(request: Request): string {
  return request.headers.get('x-request-id') || crypto.randomUUID();
}

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

function models(): string[] {
  const configured = process.env.NVIDIA_MODEL?.trim();
  return configured ? [configured, ...DEFAULT_MODELS.filter((model) => model !== configured)] : DEFAULT_MODELS;
}

function normalizePlanText(text: string): string {
  let value = text.trim();
  value = value.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  value = value.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  const first = value.indexOf('{');
  const last = value.lastIndexOf('}');
  if (first >= 0 && last > first) value = value.slice(first, last + 1);
  return value;
}

function isPlan(value: unknown): value is Plan {
  if (!value || typeof value !== 'object') return false;
  const plan = value as Record<string, unknown>;
  if (typeof plan.summary !== 'string' || !plan.summary.trim()) return false;
  const stringArrays = ['assumptions', 'acceptanceCriteria', 'verification', 'risks'];
  if (!stringArrays.every((key) => Array.isArray(plan[key]) && (plan[key] as unknown[]).every((item) => typeof item === 'string'))) return false;
  if (!Array.isArray(plan.changes)) return false;
  const operations = new Set(['create_script', 'update_script', 'create_instance', 'update_instance', 'delete_instance', 'note']);
  const risks = new Set(['low', 'medium', 'high', 'critical']);
  return plan.changes.every((item) => {
    if (!item || typeof item !== 'object') return false;
    const change = item as Record<string, unknown>;
    return typeof change.operation === 'string' && operations.has(change.operation)
      && typeof change.target === 'string' && change.target.trim().length > 0
      && typeof change.reason === 'string' && change.reason.trim().length > 0
      && typeof change.risk === 'string' && risks.has(change.risk)
      && (change.content === undefined || typeof change.content === 'string');
  });
}

function parsePlan(text: string): Plan {
  let parsed: unknown;
  try {
    parsed = JSON.parse(normalizePlanText(text));
  } catch (error) {
    throw new Error(`AI returned invalid JSON: ${error instanceof Error ? error.message : 'parse failed'}`);
  }
  if (!isPlan(parsed)) throw new Error('AI returned an invalid LUA-X plan shape.');
  return parsed;
}

function systemPrompt(): string {
  return [
    'You are LUA-X, an AI-native Roblox development engineer.',
    'Return ONLY valid JSON. Never return Markdown fences, comments, or prose outside JSON.',
    'Create a safe, reviewable implementation plan for Roblox Studio.',
    'Never claim Studio execution, tests, playtests, publishing, or runtime verification succeeded.',
    'Preserve existing creator-authored architecture and behavior.',
    'Prefer small, targeted, reversible changes.',
    'Keep authoritative gameplay logic server-side.',
    'JSON shape: {summary, assumptions, changes, acceptanceCriteria, verification, risks}.',
    'Each change must include operation, target, reason, risk. content is optional for script operations.',
  ].join('\n');
}

async function readBody(request: Request): Promise<Record<string, unknown>> {
  const declared = Number(request.headers.get('content-length') || 0);
  if (declared > MAX_BODY) throw new Error('Request body is too large.');
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_BODY) throw new Error('Request body is too large.');
  if (!text.trim()) throw new Error('Request body is required.');
  const value = JSON.parse(text) as unknown;
  if (!value || typeof value !== 'object') throw new Error('Request body must be a JSON object.');
  return value as Record<string, unknown>;
}

function validRequest(body: Record<string, unknown>): boolean {
  return typeof body.prompt === 'string' && body.prompt.trim().length >= 2 && body.prompt.length <= 12000
    && (body.projectId === undefined || typeof body.projectId === 'string')
    && (body.context === undefined || (typeof body.context === 'object' && body.context !== null));
}

async function callNvidia(baseUrl: string, model: string, key: string, body: Record<string, unknown>, id: string) {
  const maxTokens = Math.min(Math.max(Number(process.env.AI_MAX_TOKENS || 4096), 256), 16384);
  const temperature = Math.min(Math.max(Number(process.env.AI_TEMPERATURE || 0.2), 0), 1);
  const timeoutMs = Math.min(Math.max(Number(process.env.AI_TIMEOUT_MS || 60000), 1000), 120000);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${key}`,
        'content-type': 'application/json',
        accept: 'application/json',
        'x-request-id': id,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt() },
          { role: 'user', content: `Creator request: ${String(body.prompt).trim()}\nProject ID: ${typeof body.projectId === 'string' ? body.projectId : 'unknown'}\nProject context: ${JSON.stringify(body.context ?? {})}` },
        ],
        max_tokens: maxTokens,
        temperature,
        stream: false,
      }),
      signal: controller.signal,
    });

    const text = await response.text();
    let payload: unknown;
    try { payload = JSON.parse(text); } catch { payload = undefined; }
    const providerError = payload && typeof payload === 'object' && 'error' in payload
      ? (payload as { error?: unknown }).error
      : undefined;
    const message = typeof providerError === 'string'
      ? providerError
      : providerError && typeof providerError === 'object' && 'message' in providerError
        ? String((providerError as { message?: unknown }).message)
        : `NVIDIA returned HTTP ${response.status}.`;

    if (!response.ok) {
      const error = new Error(message) as Error & { status?: number; retryable?: boolean };
      error.status = response.status;
      error.retryable = response.status === 408 || response.status === 429 || response.status >= 500;
      throw error;
    }

    const choices = payload && typeof payload === 'object' ? (payload as { choices?: unknown }).choices : undefined;
    const first = Array.isArray(choices) ? choices[0] : undefined;
    const messageObject = first && typeof first === 'object' ? (first as { message?: unknown }).message : undefined;
    const content = messageObject && typeof messageObject === 'object' ? (messageObject as { content?: unknown }).content : undefined;
    if (typeof content !== 'string' || !content.trim()) throw new Error('NVIDIA returned no assistant content.');
    return { plan: parsePlan(content), model, status: 200 };
  } finally {
    clearTimeout(timer);
  }
}

export default async function handler(request: Request): Promise<Response> {
  const id = requestId(request);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'POST,OPTIONS', 'access-control-allow-headers': 'content-type,authorization,x-request-id' } });
  if (request.method !== 'POST') return json(405, { error: 'Method not allowed.', requestId: id }, { allow: 'POST, OPTIONS' });

  try {
    const body = await readBody(request);
    if (!validRequest(body)) return json(400, { error: 'Invalid AI request. Provide a prompt and optional project context.', requestId: id }, { 'x-request-id': id });

    const apiKeys = keys();
    if (!apiKeys.length) return json(503, { error: 'AI provider is not configured on the backend.', requestId: id }, { 'x-request-id': id });

    const baseUrl = (process.env.NVIDIA_BASE_URL?.trim() || DEFAULT_BASE).replace(/\/$/, '');
    const modelList = models();
    let lastMessage = 'All NVIDIA generation attempts failed.';
    let lastStatus = 502;
    let retriesUsed = 0;

    for (const model of modelList) {
      for (const key of apiKeys) {
        for (let attempt = 1; attempt <= MAX_ATTEMPTS_PER_PAIR; attempt += 1) {
          try {
            const result = await callNvidia(baseUrl, model, key, body, id);
            return json(200, {
              requestId: id,
              provider: 'nvidia',
              model: result.model,
              plan: result.plan,
              rawTextAvailable: false,
              retriesUsed,
            }, { 'x-request-id': id });
          } catch (error) {
            const status = typeof error === 'object' && error !== null && 'status' in error ? Number((error as { status?: unknown }).status) : 502;
            const retryable = typeof error === 'object' && error !== null && 'retryable' in error ? Boolean((error as { retryable?: unknown }).retryable) : true;
            lastStatus = Number.isFinite(status) && status >= 400 && status < 600 ? status : 502;
            lastMessage = error instanceof Error ? error.message : 'NVIDIA request failed.';
            if (!retryable) break;
            retriesUsed += 1;
            if (attempt < MAX_ATTEMPTS_PER_PAIR) await new Promise((resolve) => setTimeout(resolve, Math.min(1200, 350 * attempt)));
          }
        }
      }
    }

    return json(lastStatus >= 500 ? 502 : lastStatus, {
      error: 'LUA-X could not generate a plan right now.',
      detail: lastMessage,
      requestId: id,
      retryable: true,
      modelsTried: modelList,
      keysTried: apiKeys.length,
      retriesUsed,
    }, { 'x-request-id': id });
  } catch (error) {
    return json(400, { error: error instanceof Error ? error.message : 'Invalid request.', requestId: id }, { 'x-request-id': id });
  }
}
