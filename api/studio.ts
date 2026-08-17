type Presence = {
  projectId: string;
  sessionId: string;
  placeName: string;
  pluginVersion: string;
  at: number;
};

type Command = { type: string; prompt?: string; createdAt: number };

const PRESENCE_TTL = 20;
const COMMAND_TTL = 60;
const memoryPresence = new Map<string, Presence>();
const memoryCommands = new Map<string, Command>();

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

async function enqueueCommand(sessionId: string, command: Command): Promise<void> {
  memoryCommands.set(sessionId, command);
  await redisCommand(['SET', `studio:command:${sessionId}`, JSON.stringify(command), 'EX', String(COMMAND_TTL)]);
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

export default async function handler(request: Request): Promise<Response> {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { 'access-control-allow-origin': '*' } });

  const url = new URL(request.url);
  const pathname = url.pathname.replace(/^\/api\/studio\/?/, '').replace(/\/$/, '');

  if (request.method === 'POST' && pathname === 'heartbeat') {
    try {
      const body = await request.json() as Record<string, unknown>;
      const projectId = cleanString(body.projectId, 100);
      const sessionId = cleanString(body.sessionId, 100);
      if (!projectId || !sessionId) return json(400, { error: 'projectId and sessionId are required.' });
      const presence: Presence = {
        projectId,
        sessionId,
        placeName: cleanString(body.placeName, 160) || 'Roblox Studio',
        pluginVersion: cleanString(body.pluginVersion, 40) || 'unknown',
        at: Date.now(),
      };
      await storePresence(presence);
      return json(200, { ok: true, connected: true, projectId, sessionId, expiresIn: PRESENCE_TTL });
    } catch {
      return json(400, { error: 'Invalid heartbeat payload.' });
    }
  }

  if (request.method === 'POST' && pathname === 'disconnect') {
    try {
      const body = await request.json() as Record<string, unknown>;
      const sessionId = cleanString(body.sessionId, 100);
      if (!sessionId) return json(400, { error: 'sessionId is required.' });
      let foundProjectId: string | undefined;
      for (const [key, presence] of memoryPresence) {
        if (presence.sessionId === sessionId) {
          foundProjectId = presence.projectId;
          memoryPresence.delete(key);
        }
      }
      if (foundProjectId) await redisCommand(['DEL', `studio:presence:${foundProjectId}`]);
      await redisCommand(['DEL', 'studio:presence:latest']);
      return json(200, { ok: true, connected: false });
    } catch {
      return json(400, { error: 'Invalid disconnect payload.' });
    }
  }

  if (request.method === 'GET' && pathname === 'status') {
    const projectId = cleanString(url.searchParams.get('projectId'), 100) || undefined;
    const presence = await loadPresence(projectId);
    const connected = Boolean(presence && Date.now() - presence.at <= PRESENCE_TTL * 1000);
    return json(200, connected && presence ? {
      connected: true,
      projectId: presence.projectId,
      sessionId: presence.sessionId,
      placeName: presence.placeName,
      pluginVersion: presence.pluginVersion,
      lastSeenAt: presence.at,
    } : { connected: false });
  }

  if (request.method === 'POST' && pathname === 'command') {
    try {
      const body = await request.json() as Record<string, unknown>;
      const sessionId = cleanString(body.sessionId, 100);
      const type = cleanString(body.type, 40);
      if (!sessionId || !type) return json(400, { error: 'sessionId and type are required.' });
      if (!['ping', 'build', 'refresh_context'].includes(type)) return json(400, { error: 'Unsupported Studio command.' });
      const command: Command = {
        type,
        ...(typeof body.prompt === 'string' ? { prompt: body.prompt.slice(0, 12000) } : {}),
        createdAt: Date.now(),
      };
      await enqueueCommand(sessionId, command);
      return json(200, { ok: true, queued: true });
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
