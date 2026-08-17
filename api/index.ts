import type { IncomingMessage, ServerResponse } from 'node:http';
import { loadConfig } from '../apps/api/src/config.js';
import { createApiServer, type ApiDependencies } from '../apps/api/src/server.js';
import { NvidiaClient } from '../apps/api/src/nvidia.js';
import { FixedWindowRateLimiter } from '../apps/api/src/rate-limit.js';

let cachedHandler: ReturnType<typeof createApiServer> | undefined;

function getHandler() {
  if (!cachedHandler) {
    const config = loadConfig();
    const nvidia = new NvidiaClient({
      ...(config.nvidiaApiKey ? { apiKey: config.nvidiaApiKey } : {}),
      baseUrl: config.nvidiaBaseUrl,
      model: config.nvidiaModel,
      maxTokens: config.aiMaxTokens,
      temperature: config.aiTemperature,
      timeoutMs: config.aiTimeoutMs,
    });
    const limiter = new FixedWindowRateLimiter(config.rateLimitWindowMs, config.rateLimitMaxRequests);
    const deps: ApiDependencies = { config, nvidia, limiter };
    cachedHandler = createApiServer(deps);
  }
  return cachedHandler;
}

export default function handler(request: IncomingMessage, response: ServerResponse): void {
  getHandler().emit('request', request, response);
}
