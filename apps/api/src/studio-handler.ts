import { randomUUID } from 'node:crypto';

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

type ConnectRequest = {
  requestId: string;
  projectId: string;
  requestedAt: number;
  expiresAt: number;
  status: 'waiting' | 'fulfilled';
  sessionId?: string;
};

const PRESENCE_TTL = 30;
const COMMAND_TTL = 60;
const CONNECT_REQUEST_TTL = 60;
const REQUIRED_PLUGIN_VERSION = '1.2.1';
const SUPPORTED_COMMANDS = ['ping', 'refresh_context', 'build', 'analyze', 'apply', 'verify', 'stop'];
const memoryPresence = new Map<string, Presence>();
const memoryCommands = new Map<string, Command>();
const memoryCommandLog = new Map<string, CommandLog>();
const memoryConnectRequests = new Map<string, ConnectRequest>();
let memoryLatestRequestId: string | null = null;

let redisWarned = false;

function redisConfig() {
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  const configured = url && token ? { url: url.replace(/\/$/, ''), token } : null;
  if (!configured && !redisWarned) {
    redisWarned = true;
    console.warn('[studio-handler] Redis not configured — Studio bridge uses in-memory state. On Vercel, connection may reset on cold start. Add UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN for reliable operation.');
  }
  return configured;
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

function versionParts(version: string): number[] {
  return String(version || '').split('.').map((part) => parseInt(part, 10) || 0);
}

function versionAtLeast(installed: string, required: string): boolean {
  const a = versionParts(installed);
  const b = versionParts(required);
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    if (av !== bv) return av > bv;
  }
  return true;
}

function versionStatusFor(installed: string): 'current' | 'update_required' {
  return installed === 'unknown' || !versionAtLeast(installed, REQUIRED_PLUGIN_VERSION)
    ? 'update_required'
    : 'current';
}

function parsePresence(body: Record<string, unknown>): Presence | null {
  const projectId = cleanString(body.projectId, 100);
  const sessionId = cleanString(body.sessionId, 100);
  if (!projectId || !sessionId) return null;
  const capabilities = Array.isArray(body.capabilities)
    ? body.capabilities.map((item) => cleanString(item, 40)).filter(Boolean).slice(0, 20)
    : [];
  const context = body.context && typeof body.context === 'object'
    ? {
        selection: cleanCount((body.context as Record<string, unknown>).selection) ?? 0,
        scripts: cleanCount((body.context as Record<string, unknown>).scripts) ?? 0,
        at: Date.now(),
      }
    : null;
  const placeId = cleanString(body.placeId, 100) || null;
  return {
    projectId,
    sessionId,
    placeName: cleanString(body.placeName, 160) || 'Roblox Studio',
    pluginVersion: cleanString(body.pluginVersion, 40) || 'unknown',
    ...(placeId ? { placeId } : {}),
    ...(capabilities.length > 0 ? { capabilities } : {}),
    ...(context ? { context } : {}),
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
  // Fallback to memory - try exact key first, then scan for freshest if latest missing
  if (projectId) {
    const mem = memoryPresence.get(`project:${projectId}`);
    if (mem && Date.now() - mem.at <= PRESENCE_TTL * 1000) return mem;
  } else {
    const mem = memoryPresence.get('latest');
    if (mem && Date.now() - mem.at <= PRESENCE_TTL * 1000) return mem;
    // Scan all presence entries for freshest as fallback for Vercel instance mismatch
    let freshest: Presence | null = null;
    for (const p of memoryPresence.values()) {
      if (Date.now() - p.at <= PRESENCE_TTL * 1000 && (!freshest || p.at > freshest.at)) freshest = p;
    }
    if (freshest) return freshest;
  }
  return null;
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

function connectRequestAlive(request: ConnectRequest): boolean {
  return request.status === 'waiting' && request.expiresAt > Date.now();
}

async function storeConnectRequest(request: ConnectRequest): Promise<void> {
  memoryConnectRequests.set(request.requestId, request);
  memoryLatestRequestId = request.requestId;
  const payload = JSON.stringify(request);
  await redisCommand(['SET', `studio:connect:${request.requestId}`, payload, 'EX', String(CONNECT_REQUEST_TTL)]);
  await redisCommand(['SET', 'studio:connect:latest', request.requestId, 'EX', String(CONNECT_REQUEST_TTL)]);
}

async function loadPendingConnectRequest(): Promise<ConnectRequest | null> {
  const latestId = await redisCommand(['GET', 'studio:connect:latest']);
  if (typeof latestId === 'string' && latestId) {
    const remote = await redisCommand(['GET', `studio:connect:${latestId}`]);
    if (typeof remote === 'string') {
      try {
        const parsed = JSON.parse(remote) as ConnectRequest;
        if (connectRequestAlive(parsed)) return parsed;
      } catch { /* fall through */ }
    }
  }
  if (memoryLatestRequestId) {
    const memory = memoryConnectRequests.get(memoryLatestRequestId);
    if (memory && connectRequestAlive(memory)) return memory;
  }
  // Fallback scan - find any alive waiting request (for Vercel cold start where latest pointer lost)
  let freshest: ConnectRequest | null = null;
  for (const req of memoryConnectRequests.values()) {
    if (connectRequestAlive(req) && (!freshest || req.requestedAt > freshest.requestedAt)) freshest = req;
  }
  return freshest;
}

async function fulfillConnectRequest(requestId: string, sessionId: string): Promise<boolean> {
  let claimed = false;
  const remote = await redisCommand(['GET', `studio:connect:${requestId}`]);
  if (typeof remote === 'string') {
    try {
      const parsed = JSON.parse(remote) as ConnectRequest;
      if (connectRequestAlive(parsed)) {
        parsed.status = 'fulfilled';
        parsed.sessionId = sessionId;
        await redisCommand(['SET', `studio:connect:${requestId}`, JSON.stringify(parsed), 'EX', String(CONNECT_REQUEST_TTL)]);
        await redisCommand(['DEL', 'studio:connect:latest']);
        claimed = true;
      }
    } catch { /* fall through */ }
  }
  const memory = memoryConnectRequests.get(requestId);
  if (memory && connectRequestAlive(memory)) {
    memory.status = 'fulfilled';
    memory.sessionId = sessionId;
    if (memoryLatestRequestId === requestId) memoryLatestRequestId = null;
    claimed = true;
  }
  return claimed;
}

async function connectRequestStatus(requestId: string): Promise<{ status: 'waiting' | 'fulfilled' | 'expired'; sessionId?: string }> {
  const remote = await redisCommand(['GET', `studio:connect:${requestId}`]);
  if (typeof remote === 'string') {
    try {
      const parsed = JSON.parse(remote) as ConnectRequest;
      if (parsed.expiresAt <= Date.now()) return { status: 'expired' };
      if (parsed.status === 'fulfilled') return { status: 'fulfilled', ...(parsed.sessionId ? { sessionId: parsed.sessionId } : {}) };
      return { status: 'waiting' };
    } catch { /* fall through */ }
  }
  const memory = memoryConnectRequests.get(requestId);
  if (!memory) return { status: 'expired' };
  if (memory.expiresAt <= Date.now()) return { status: 'expired' };
  if (memory.status === 'fulfilled') return { status: 'fulfilled', ...(memory.sessionId ? { sessionId: memory.sessionId } : {}) };
  return { status: 'waiting' };
}

async function handleStudioRequest(request: Request, url: URL, pathname: string): Promise<Response> {

  if (request.method === 'POST' && pathname === 'connect') {
    try {
      const body = await request.json() as Record<string, unknown>;
      const projectId = cleanString(body.projectId, 100) || 'web';
      const now = Date.now();
      const connectRequest: ConnectRequest = {
        requestId: `connect_${randomUUID()}`,
        projectId,
        requestedAt: now,
        expiresAt: now + CONNECT_REQUEST_TTL * 1000,
        status: 'waiting',
      };
      await storeConnectRequest(connectRequest);
      return json(200, { requestId: connectRequest.requestId, status: 'waiting', expiresIn: CONNECT_REQUEST_TTL });
    } catch {
      return json(400, { error: 'Invalid connect payload.' });
    }
  }

  if (request.method === 'GET' && pathname === 'connect/pending') {
    const pending = await loadPendingConnectRequest();
    return json(200, {
      request: pending
        ? {
            requestId: pending.requestId,
            projectId: pending.projectId,
            expiresIn: Math.max(0, Math.round((pending.expiresAt - Date.now()) / 1000)),
          }
        : null,
    });
  }

  if (request.method === 'GET' && pathname === 'connect/status') {
    const requestId = cleanString(url.searchParams.get('requestId'), 100);
    if (!requestId) return json(400, { error: 'requestId is required.' });
    return json(200, await connectRequestStatus(requestId));
  }

  if (request.method === 'POST' && pathname === 'register') {
    try {
      const body = await request.json() as Record<string, unknown>;
      const presence = parsePresence(body);
      if (!presence) return json(400, { error: 'projectId and sessionId are required.' });
      const requestId = cleanString(body.requestId, 100) || null;
      const fulfilled = requestId ? await fulfillConnectRequest(requestId, presence.sessionId) : null;
      await storePresence(presence);
      return json(200, {
        connected: true,
        sessionId: presence.sessionId,
        projectId: presence.projectId,
        expiresIn: PRESENCE_TTL,
        requiredVersion: REQUIRED_PLUGIN_VERSION,
        versionStatus: versionStatusFor(presence.pluginVersion),
        ...(requestId ? { requestStatus: fulfilled ? 'fulfilled' : 'not_found' } : {}),
      });
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
      return json(200, {
        ok: true,
        connected: true,
        projectId: presence.projectId,
        sessionId: presence.sessionId,
        expiresIn: PRESENCE_TTL,
        requiredVersion: REQUIRED_PLUGIN_VERSION,
        versionStatus: versionStatusFor(presence.pluginVersion),
      });
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

  if (request.method === 'GET' && pathname === 'ping') {
    return json(200, { ok: true, service: 'studio', runtime: 'nodejs' });
  }

  if (request.method === 'GET' && pathname === 'diagnostics') {
    let redisReachable = false;
    try {
      const pong = await redisCommand(['PING']);
      redisReachable = pong === 'PONG';
    } catch {
      redisReachable = false;
    }
    return json(200, {
      service: 'studio',
      runtime: 'nodejs',
      handler: 'loaded',
      version: REQUIRED_PLUGIN_VERSION,
      api: 'ok',
      connectRoute: 'ok',
      pendingRoute: 'ok',
      statusRoute: 'ok',
      registerRoute: 'ok',
      heartbeatRoute: 'ok',
      disconnectRoute: 'ok',
      commandRoute: 'ok',
      diagnosticsRoute: 'ok',
      redisConfigured: Boolean(redisConfig()),
      redisReachable,
      memory: 'ok',
    });
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
      requiredVersion: REQUIRED_PLUGIN_VERSION,
      versionStatus: versionStatusFor(presence.pluginVersion),
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

export default async function handler(request: Request): Promise<Response> {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET,POST,OPTIONS', 'access-control-allow-headers': 'content-type,authorization,x-request-id' } });

  let url: URL;
  let pathname: string;
  try {
    url = new URL(request.url);
    pathname = url.pathname.replace(/^\/api\/studio\/?/, '').replace(/^\/studio\/?/, '').replace(/\/$/, '');
  } catch {
    return json(400, { error: 'Invalid request URL.' });
  }

  try {
    return await handleStudioRequest(request, url, pathname);
  } catch (error) {
    const requestId = request.headers.get('x-request-id') || `studio_${Date.now().toString(36)}`;
    const stage = pathname === 'connect' ? 'create-request' : undefined;
    console.error(
      `[studio-handler] route=${pathname} method=${request.method}${stage ? ` stage=${stage}` : ''} requestId=${requestId}`,
      error instanceof Error ? error : new Error(String(error)),
    );
    const code = pathname === 'connect' ? 'STUDIO_CONNECT_FAILED' : 'STUDIO_HANDLER_FAILED';
    return json(500, { error: { code, message: 'Studio connection service failed.', requestId } });
  }
}