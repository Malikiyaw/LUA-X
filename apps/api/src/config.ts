export interface ApiConfig {
  host: string;
  port: number;
  nodeEnv: string;
  nvidiaApiKeys: string[];
  nvidiaBaseUrl: string;
  nvidiaModel: string;
  aiMaxTokens: number;
  aiTemperature: number;
  aiTimeoutMs: number;
  rateLimitWindowMs: number;
  rateLimitMaxRequests: number;
  corsOrigin: string;
}

function intEnv(name: string, fallback: number): number {
  const value = process.env[name];
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error(`${name} must be a non-negative integer.`);
  return parsed;
}

function floatEnv(name: string, fallback: number, min: number, max: number): number {
  const value = process.env[name];
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) throw new Error(`${name} must be between ${min} and ${max}.`);
  return parsed;
}

function readNvidiaKeys(): string[] {
  const numbered = [1, 2, 3, 4]
    .map((index) => process.env[`NVIDIA_API_KEY_${index}`]?.trim())
    .filter((key): key is string => Boolean(key));

  const legacy = process.env.NVIDIA_API_KEY?.trim();
  const keys = legacy ? [legacy, ...numbered] : numbered;
  return [...new Set(keys)];
}

export function loadConfig(): ApiConfig {
  const port = intEnv('PORT', 4000);
  if (port > 65535) throw new Error('PORT must be <= 65535.');

  return {
    host: process.env.HOST ?? '127.0.0.1',
    port,
    nodeEnv: process.env.NODE_ENV ?? 'development',
    nvidiaApiKeys: readNvidiaKeys(),
    nvidiaBaseUrl: (process.env.NVIDIA_BASE_URL ?? 'https://integrate.api.nvidia.com/v1').replace(/\/$/, ''),
    nvidiaModel: process.env.NVIDIA_MODEL ?? 'nvidia/llama-3.3-nemotron-super-49b-v1',
    aiMaxTokens: intEnv('AI_MAX_TOKENS', 4096),
    aiTemperature: floatEnv('AI_TEMPERATURE', 0.2, 0, 1),
    aiTimeoutMs: intEnv('AI_TIMEOUT_MS', 60000),
    rateLimitWindowMs: intEnv('RATE_LIMIT_WINDOW_MS', 60000),
    rateLimitMaxRequests: Math.max(1, intEnv('RATE_LIMIT_MAX_REQUESTS', 30)),
    corsOrigin: process.env.CORS_ORIGIN ?? 'http://127.0.0.1:3000',
  };
}
