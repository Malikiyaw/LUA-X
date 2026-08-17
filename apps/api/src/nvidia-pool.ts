import { NvidiaApiError, NvidiaClient, type ChatMessage, type NvidiaChatResponse, type NvidiaClientOptions } from './nvidia.js';

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

        // Temporarily move a throttled/degraded key out of the selection pool.
        const cooldownMs = error.status === 429 ? 1500 : 500;
        entry.cooldownUntil = Date.now() + cooldownMs;
        excluded.add(index);
      } finally {
        entry.inFlight = Math.max(0, entry.inFlight - 1);
      }
    }

    if (lastError instanceof NvidiaApiError) throw lastError;
    throw new NvidiaApiError('All NVIDIA API keys failed.', 502, true);
  }
}
