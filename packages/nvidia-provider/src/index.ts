export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface NvidiaChatResponse {
  content: string;
  model?: string;
  requestId?: string;
}

export class NvidiaApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryable: boolean,
    readonly requestId?: string,
  ) {
    super(message);
    this.name = 'NvidiaApiError';
  }
}

export interface NvidiaClientOptions {
  apiKey?: string;
  baseUrl: string;
  model: string;
  maxTokens: number;
  temperature: number;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
}

export class NvidiaClient {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: NvidiaClientOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  isConfigured(): boolean {
    return Boolean(this.options.apiKey);
  }

  async chat(messages: readonly ChatMessage[]): Promise<NvidiaChatResponse> {
    if (!this.options.apiKey) throw new NvidiaApiError('NVIDIA API key is not configured.', 503, false);
    if (!messages.length) throw new NvidiaApiError('At least one message is required.', 400, false);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs);

    try {
      const response = await this.fetchImpl(`${this.options.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.options.apiKey}`,
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify({
          model: this.options.model,
          messages,
          max_tokens: this.options.maxTokens,
          temperature: this.options.temperature,
          stream: false,
        }),
        signal: controller.signal,
      });

      const requestId = response.headers.get('x-request-id') ?? response.headers.get('request-id') ?? undefined;
      const text = await response.text();
      let payload: unknown;
      try {
        payload = JSON.parse(text);
      } catch {
        payload = undefined;
      }

      if (!response.ok) {
        const message = typeof payload === 'object' && payload !== null && 'error' in payload
          ? String((payload as { error?: unknown }).error)
          : `NVIDIA request failed with HTTP ${response.status}.`;
        const retryable = response.status === 408 || response.status === 429 || response.status >= 500;
        throw new NvidiaApiError(message, response.status, retryable, requestId);
      }

      if (!payload || typeof payload !== 'object') {
        throw new NvidiaApiError('NVIDIA returned an invalid response.', 502, true, requestId);
      }

      const choices = (payload as { choices?: unknown }).choices;
      const choice = Array.isArray(choices) ? choices[0] : undefined;
      const message = typeof choice === 'object' && choice !== null
        ? (choice as { message?: unknown }).message
        : undefined;
      const content = typeof message === 'object' && message !== null
        ? (message as { content?: unknown }).content
        : undefined;

      if (typeof content !== 'string' || !content.trim()) {
        throw new NvidiaApiError('NVIDIA returned no assistant content.', 502, true, requestId);
      }

      const model = typeof (payload as { model?: unknown }).model === 'string'
        ? (payload as { model: string }).model
        : undefined;

      return requestId
        ? (model ? { content, model, requestId } : { content, requestId })
        : (model ? { content, model } : { content });
    } catch (error) {
      if (error instanceof NvidiaApiError) throw error;
      if (error instanceof Error && error.name === 'AbortError') {
        throw new NvidiaApiError('NVIDIA request timed out.', 504, true);
      }
      throw new NvidiaApiError(error instanceof Error ? error.message : 'NVIDIA request failed.', 502, true);
    } finally {
      clearTimeout(timer);
    }
  }
}

interface PoolEntry {
  client: NvidiaClient;
  inFlight: number;
  cooldownUntil: number;
}

export interface NvidiaPoolOptions extends Omit<NvidiaClientOptions, 'apiKey'> {
  apiKeys: readonly string[];
}

export class NvidiaClientPool {
  private readonly entries: PoolEntry[];

  constructor(options: NvidiaPoolOptions) {
    const keys = [...new Set(options.apiKeys.map((key) => key.trim()).filter(Boolean))];
    if (keys.length === 0) throw new Error('At least one NVIDIA API key is required.');

    this.entries = keys.map((apiKey) => ({
      client: new NvidiaClient({ ...options, apiKey }),
      inFlight: 0,
      cooldownUntil: 0,
    }));
  }

  get size(): number {
    return this.entries.length;
  }

  isConfigured(): boolean {
    return this.entries.length > 0;
  }

  private selectEntry(excluded: Set<number>): number {
    const now = Date.now();
    const available = this.entries
      .map((entry, index) => ({ entry, index }))
      .filter(({ index, entry }) => !excluded.has(index) && entry.cooldownUntil <= now);

    const candidates = available.length > 0
      ? available
      : this.entries
          .map((entry, index) => ({ entry, index }))
          .filter(({ index }) => !excluded.has(index));

    if (candidates.length === 0) throw new NvidiaApiError('No NVIDIA API key is currently available.', 503, true);

    candidates.sort((a, b) => {
      if (a.entry.inFlight !== b.entry.inFlight) return a.entry.inFlight - b.entry.inFlight;
      return a.entry.cooldownUntil - b.entry.cooldownUntil;
    });

    return candidates[0]!.index;
  }

  async chat(messages: readonly ChatMessage[]): Promise<NvidiaChatResponse> {
    const excluded = new Set<number>();
    let lastError: unknown;

    for (let attempt = 0; attempt < this.entries.length; attempt += 1) {
      const index = this.selectEntry(excluded);
      const entry = this.entries[index]!;
      entry.inFlight += 1;

      try {
        return await entry.client.chat(messages);
      } catch (error) {
        lastError = error;
        if (!(error instanceof NvidiaApiError) || !error.retryable || this.entries.length === 1) throw error;
        entry.cooldownUntil = Date.now() + (error.status === 429 ? 1500 : 500);
        excluded.add(index);
      } finally {
        entry.inFlight = Math.max(0, entry.inFlight - 1);
      }
    }

    if (lastError instanceof NvidiaApiError) throw lastError;
    throw new NvidiaApiError('All NVIDIA API keys failed.', 502, true);
  }
}
