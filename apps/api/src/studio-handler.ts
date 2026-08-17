type Presence = {
  projectId: string;
  sessionId: string;
  placeName: string;
  placeId?: string;
  pluginVersion: string;
  capabilities?: string[];
  context?: { selection: number; scripts: number; at: number };
  at: number;
};

type Command = { type: string; prompt?: string; createdAt: number };

type CommandLog = { type: string; at: number };

const PRESENCE_TTL = 20;
const COMMAND_TTL = 60;
const SUPPORTED_COMMANDS = ['ping', 'refresh_context', 'build', 'analyze', 'apply', 'verify', 'stop'];
const memoryPresence = new Map<string, Presence>();
const memoryCommands = new Map<string, Command>();
const memoryCommandLog = new Map<string, CommandLog>();

function redisConfig() {
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  return url && token ? { url: url.replace(/\/$/, ''), token } : null;
}

async function redisCommand(command: string[]): Promise<unknown | null> {
  const config = redisConfig();
  if (!config) return null;
  try {
    const encoded = command.map((part) => encodeURIComponent(part)).join('/');
    const response = await fetch(`${config.url}/${encoded}`, {
      headers: { authorization: `Bearer ${config.token}` },
    });
    if (!response.ok) return null;
    const payload = await response.json() as { result?: unknown };
    return payload.result ?? null;
  } catch {
    return null;
  }
}

function json(status: number, payload: unknown, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET,POST,OPTIONS',
      'access-control-allow-headers': 'content-type,authorization,x-request-id',
      ...extra,
    },
  });
}

function cleanString(value: unknown, max = 256): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function cleanCount(value: unknown): number | undefined {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 && n <= 100000 ? Math.floor(n) : undefined;
}

function parsePresence(body: Record<string, unknown>): Presence | null {
  const projectId = cleanString(body.projectId, 100);
  const sessionId = cleanString(body.sessionId, 100);
  if (!projectId || !sessionId) return null;
  const capabilities = Array.isArray(body.capabilities)
    ? body.capabilities.map((item) => cleanString(item, 40)).filter(Boolean).slice(0, 20)
    : [];
  return {
    projectId,
    sessionId,
    placeName: cleanString(body.placeName, 160) || 'Roblox Studio',
    placeId: cleanString(body.placeId, 100) || undefined,
    pluginVersion: cleanString(body.pluginVersion, 40) || 'unknown',
    ...(capabilities.length > 0 ? { capabilities } : {}),
    context: body.context && typeof body.context === 'object'
      ? {
          selection: cleanCount((body.context as Record<string, unknown>).selection) ?? 0,
          scripts: cleanCount((body.context as Record<string, unknown>).scripts) ?? 0,
          at: Date.now(),
        }
      : undefined,
    at: Date.now(),
  };
}

async function storePresence(presence: Presence): Promise<void> {
  memoryPresence.set(`project:${presence.projectId}`, presence);
  memoryPresence.set('latest', presence);
  const payload = JSON.stringify(presence);
  await redisCommand(['SET', `studio:presence:${presence.projectId}`, payload, 'EX', String(PRESENCE_TTL)]);
  await redisCommand(['SET', 'studio:presence:latest', payload, 'EX', String(PRESENCE_TTL)]);
}

async function loadPresence(projectId?: string): Promise<Presence | null> {
  const key = projectId ? `studio:presence:${projectId}` : 'studio:presence:latest';
  const remote = await redisCommand(['GET', key]);
  if (typeof remote === 'string') {
    try { return JSON.parse(remote) as Presence; } catch { /* fall through */ }
  }
  const memory = projectId ? memoryPresence.get(`project:${projectId}`) : memoryPresence.get('latest');
  if (!memory) return null;
  if (Date.now() - memory.at > PRESENCE_TTL * 1000) return null;
  return memory;
}

async function clearPresence(sessionId: string): Promise<void> {
  let foundProjectId: string | undefined;
  for (const [key, presence] of memoryPresence) {
    if (presence.sessionId === sessionId) {
      foundProjectId = presence.projectId;
      memoryPresence.delete(key);
    }
  }
  if (foundProjectId) await redisCommand(['DEL', `studio:presence:${foundProjectId}`]);
  await redisCommand(['DEL', 'studio:presence:latest']);
}

async function enqueueCommand(sessionId: string, command: Command): Promise<void> {
  memoryCommands.set(sessionId, command);
  memoryCommandLog.set(sessionId, { type: command.type, at: Date.now() });
  await redisCommand(['SET', `studio:command:${sessionId}`, JSON.stringify(command), 'EX', String(COMMAND_TTL)]);
  await redisCommand(['SET', `studio:lastcommand:${sessionId}`, JSON.stringify({ type: command.type, at: Date.now() }), 'EX', String(COMMAND_TTL)]);
}

async function takeCommand(sessionId: string): Promise<Command | null> {
  const remote = await redisCommand(['GET', `studio:command:${sessionId}`]);
  if (typeof remote === 'string') {
    await redisCommand(['DEL', `studio:command:${sessionId}`]);
    try { return JSON.parse(remote) as Command; } catch { return null; }
  }
  const memory = memoryCommands.get(sessionId);
  if (!memory) return null;
  memoryCommands.delete(sessionId);
  if (Date.now() - memory.createdAt > COMMAND_TTL * 1000) return null;
  return memory;
}

async function lastCommand(sessionId: string): Promise<CommandLog | null> {
  const memory = memoryCommandLog.get(sessionId);
  if (memory && Date.now() - memory.at <= COMMAND_TTL * 1000) return memory;
  const remote = await redisCommand(['GET', `studio:lastcommand:${sessionId}`]);
  if (typeof remote === 'string') {
    try { return JSON.parse(remote) as CommandLog; } catch { return null; }
  }
  return memory ?? null;
}

export default async function handler(request: Request): Promise<Response> {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { 'access-control-allow-origin': '*' } });

  const url = new URL(request.url);
  const pathname = url.pathname.replace(/^\/api\/studio\/?/, '').replace(/^\/studio\/?/, '').replace(/\/$/, '');

  if (request.method === 'POST' && pathname === 'register') {
    try {
      const body = await request.json() as Record<string, unknown>;
      const presence = parsePresence(body);
      if (!presence) return json(400, { error: 'projectId and sessionId are required.' });
      await storePresence(presence);
      return json(200, { connected: true, sessionId: presence.sessionId, projectId: presence.projectId, expiresIn: PRESENCE_TTL });
    } catch {
      return json(400, { error: 'Invalid register payload.' });
    }
  }

  if (request.method === 'POST' && pathname === 'heartbeat') {
    try {
      const body = await request.json() as Record<string, unknown>;
      const presence = parsePresence(body);
      if (!presence) return json(400, { error: 'projectId and sessionId are required.' });
      await storePresence(presence);
      return json(200, { ok: true, connected: true, projectId: presence.projectId, sessionId: presence.sessionId, expiresIn: PRESENCE_TTL });
    } catch {
      return json(400, { error: 'Invalid heartbeat payload.' });
    }
  }

  if (request.method === 'POST' && pathname === 'disconnect') {
    try {
      const body = await request.json() as Record<string, unknown>;
      const sessionId = cleanString(body.sessionId, 100);
      if (!sessionId) return json(400, { error: 'sessionId is required.' });
      await clearPresence(sessionId);
      return json(200, { ok: true, connected: false });
    } catch {
      return json(400, { error: 'Invalid disconnect payload.' });
    }
  }

  if (request.method === 'GET' && pathname === 'status') {
    const projectId = cleanString(url.searchParams.get('projectId'), 100) || undefined;
    const presence = await loadPresence(projectId);
    const connected = Boolean(presence && Date.now() - presence.at <= PRESENCE_TTL * 1000);
    if (!connected || !presence) return json(200, { connected: false });
    const last = presence ? await lastCommand(presence.sessionId) : null;
    return json(200, {
      connected: true,
      projectId: presence.projectId,
      sessionId: presence.sessionId,
      placeName: presence.placeName,
      placeId: presence.placeId || presence.projectId,
      pluginVersion: presence.pluginVersion,
      capabilities: presence.capabilities ?? [],
      context: presence.context ?? null,
      lastSeenAt: presence.at,
      lastCommand: last ? { type: last.type, at: last.at } : null,
    });
  }

  if (request.method === 'POST' && pathname === 'command') {
    try {
      const body = await request.json() as Record<string, unknown>;
      const sessionId = cleanString(body.sessionId, 100);
      const type = cleanString(body.type, 40);
      if (!sessionId || !type) return json(400, { error: 'sessionId and type are required.' });
      if (!SUPPORTED_COMMANDS.includes(type)) return json(400, { error: 'Unsupported Studio command.' });
      const command: Command = {
        type,
        ...(typeof body.prompt === 'string' ? { prompt: body.prompt.slice(0, 12000) } : {}),
        createdAt: Date.now(),
      };
      await enqueueCommand(sessionId, command);
      return json(200, { ok: true, queued: true, type });
    } catch {
      return json(400, { error: 'Invalid command payload.' });
    }
  }

  if (request.method === 'GET' && pathname === 'command') {
    const sessionId = cleanString(url.searchParams.get('sessionId'), 100);
    if (!sessionId) return json(400, { error: 'sessionId is required.' });
    const command = await takeCommand(sessionId);
    return json(200, { command });
  }

  return json(404, { error: 'Studio route not found.' });
}