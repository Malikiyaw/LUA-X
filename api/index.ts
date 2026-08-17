import type { IncomingMessage, ServerResponse } from 'node:http';
import { loadConfig } from '../apps/api/src/config.js';
import { handleApiRequest, type ApiDependencies } from '../apps/api/src/server.js';
import { NvidiaClient } from '../apps/api/src/nvidia.js';
import { FixedWindowRateLimiter } from '../apps/api/src/rate-limit.js';

let dependencies: ApiDependencies | undefined;

function getDependencies(): ApiDependencies {
  if (!dependencies) {
    const config = loadConfig();
    const nvidia = new NvidiaClient({
      ...(config.nvidiaApiKey ? { apiKey: config.nvidiaApiKey } : {}),
      baseUrl: config.nvidiaBaseUrl,
      model: config.nvidiaModel,
      maxTokens: config.aiMaxTokens,
      temperature: config.aiTemperature,
      timeoutMs: config.aiTimeoutMs,
    });
    dependencies = {
      config,
      nvidia,
      limiter: new FixedWindowRateLimiter(config.rateLimitWindowMs, config.rateLimitMaxRequests),
    };
  }
  return dependencies;
}

export default async function handler(request: IncomingMessage, response: ServerResponse): Promise<void> {
  await handleApiRequest(getDependencies(), request, response);
}
