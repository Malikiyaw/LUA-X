import { existsSync, readdirSync, statSync } from 'node:fs';
import { spawn, type ChildProcess } from 'node:child_process';
import { homedir, platform } from 'node:os';
import { join } from 'node:path';
import type { RobloxMcpTool, RobloxMcpTransport, RobloxMcpRequest, RobloxMcpResult } from '@lua-x/roblox-mcp-bridge';

export type StdioTransportOptions = {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  studioId?: string;
  requestTimeoutMs?: number;
  toolDiscoveryAttempts?: number;
  toolDiscoveryDelayMs?: number;
};

type JsonRpcResponse = {
  jsonrpc?: string;
  id?: string | number;
  result?: unknown;
  error?: { code?: number; message?: string; data?: unknown };
};

type Pending = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
};

export type ResolvedMcpCommand = {
  command: string;
  args: string[];
  source: 'override' | 'windows-exe' | 'windows-bat' | 'macos-exe' | 'fallback';
};

function newestStudioMcpWindows(): string | null {
  const localAppData = process.env.LOCALAPPDATA;
  if (!localAppData) return null;
  const candidates = [
    join(localAppData, 'Roblox Studio', 'StudioMCP.exe'),
  ];
  const versionsRoot = join(localAppData, 'Roblox', 'Versions');
  try {
    for (const entry of readdirSync(versionsRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const executable = join(versionsRoot, entry.name, 'StudioMCP.exe');
      if (existsSync(executable)) candidates.push(executable);
    }
  } catch {
    // Roblox may not have the version directory yet.
  }
  const existing = candidates.filter((path) => {
    try { return statSync(path).isFile(); } catch { return false; }
  });
  if (existing.length === 0) return null;
  existing.sort((a, b) => {
    try { return statSync(b).mtimeMs - statSync(a).mtimeMs; } catch { return 0; }
  });
  return existing[0] ?? null;
}

export function resolveStudioMcpCommand(options: StdioTransportOptions = {}): ResolvedMcpCommand {
  const override = options.command?.trim() || process.env.LUA_X_STUDIO_MCP_PATH?.trim();
  if (override) return { command: override, args: options.args ?? [], source: 'override' };

  if (platform() === 'win32') {
    const exe = newestStudioMcpWindows();
    if (exe) return { command: exe, args: options.args ?? [], source: 'windows-exe' };
    const bat = join(process.env.LOCALAPPDATA ?? '', 'Roblox', 'mcp.bat');
    if (existsSync(bat)) return { command: 'cmd.exe', args: ['/d', '/s', '/c', bat, ...(options.args ?? [])], source: 'windows-bat' };
    return { command: 'cmd.exe', args: ['/d', '/c', 'echo Roblox Studio MCP was not found.'], source: 'fallback' };
  }

  const mac = '/Applications/RobloxStudio.app/Contents/MacOS/StudioMCP';
  if (existsSync(mac)) return { command: mac, args: options.args ?? [], source: 'macos-exe' };
  const homeMac = join(homedir(), 'Applications', 'RobloxStudio.app', 'Contents', 'MacOS', 'StudioMCP');
  if (existsSync(homeMac)) return { command: homeMac, args: options.args ?? [], source: 'macos-exe' };
  return { command: '/bin/sh', args: ['-lc', 'echo Roblox Studio MCP was not found.'], source: 'fallback' };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function extractText(result: unknown): string {
  const obj = asRecord(result);
  const content = Array.isArray(obj.content) ? obj.content : [];
  return content
    .map((part) => {
      const p = asRecord(part);
      return typeof p.text === 'string' ? p.text : '';
    })
    .filter(Boolean)
    .join('\n');
}

function errorFromRpc(result: unknown, fallback: string): Error | null {
  const rpcError = asRecord(asRecord(result).__rpcError);
  if (Object.keys(rpcError).length === 0) return null;
  return new Error(String(rpcError.message ?? fallback));
}

export class StdioMcpTransport implements RobloxMcpTransport {
  private proc: ChildProcess | null = null;
  private buffer = '';
  private pending = new Map<string, Pending>();
  private seq = 0;
  private initialized = false;
  private tools: RobloxMcpTool[] = [];

  constructor(private readonly opts: StdioTransportOptions = {}) {}

  getResolvedCommand(): ResolvedMcpCommand {
    return resolveStudioMcpCommand(this.opts);
  }

  start(): void {
    if (this.proc && !this.proc.killed) return;
    const resolved = this.getResolvedCommand();
    this.proc = spawn(resolved.command, resolved.args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: false,
      windowsHide: true,
      env: { ...process.env, ...(this.opts.env ?? {}) } as NodeJS.ProcessEnv,
    });

    this.proc.stdout?.setEncoding('utf8');
    this.proc.stdout?.on('data', (chunk: string) => this.onData(chunk));
    this.proc.stderr?.setEncoding('utf8');
    this.proc.stderr?.on('data', (chunk: string) => {
      const text = String(chunk).trim();
      if (text) console.error('[LUA-X MCP]', text.slice(0, 1500));
    });
    this.proc.on('error', (error) => {
      this.failPending(error instanceof Error ? error : new Error(String(error)));
    });
    this.proc.on('exit', (code, signal) => {
      this.failPending(new Error(`Roblox Studio MCP exited${code === null ? '' : ` with code ${code}`}${signal ? ` (${signal})` : ''}.`));
      this.proc = null;
      this.initialized = false;
      this.tools = [];
    });
  }

  private failPending(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }

  private onData(chunk: string): void {
    this.buffer += chunk;
    let index = -1;
    while ((index = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, index).replace(/\r$/, '').trim();
      this.buffer = this.buffer.slice(index + 1);
      if (!line) continue;
      try {
        const parsed = JSON.parse(line) as JsonRpcResponse;
        if (parsed.id === undefined || parsed.id === null) continue;
        const pending = this.pending.get(String(parsed.id));
        if (!pending) continue;
        this.pending.delete(String(parsed.id));
        clearTimeout(pending.timer);
        pending.resolve(parsed.error ? { __rpcError: parsed.error } : parsed.result);
      } catch {
        console.error('[LUA-X MCP] Ignoring non-JSON stdout line:', line.slice(0, 500));
      }
    }
  }

  private async rpc(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    this.start();
    if (!this.proc?.stdin?.writable) throw new Error(`Roblox Studio MCP is not writable. (${this.getResolvedCommand().source})`);
    const id = String(++this.seq);
    const payload = JSON.stringify({ jsonrpc: '2.0', id, method, params });
    const timeoutMs = this.opts.requestTimeoutMs ?? 30000;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`MCP request timed out after ${timeoutMs}ms: ${method}`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.proc?.stdin?.write(`${payload}\n`, (error) => {
        if (!error) return;
        this.pending.delete(id);
        clearTimeout(timer);
        reject(error);
      });
    });
  }

  private notify(method: string, params: Record<string, unknown> = {}): void {
    if (!this.proc?.stdin?.writable) throw new Error('Roblox Studio MCP is not writable.');
    this.proc.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`);
  }

  private async ensureInitialized(): Promise<void> {
    if (this.initialized) return;
    const result = await this.rpc('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'LUA-X', version: '0.11.0-alpha' },
    });
    const error = errorFromRpc(result, 'MCP initialize failed.');
    if (error) throw error;
    this.notify('notifications/initialized');
    this.initialized = true;
  }

  async connect(): Promise<void> {
    await this.ensureInitialized();
    const attempts = Math.max(1, this.opts.toolDiscoveryAttempts ?? 12);
    const delayMs = Math.max(100, this.opts.toolDiscoveryDelayMs ?? 1000);
    let lastError: Error | null = null;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        const tools = await this.listTools();
        if (tools.length > 0 || attempt === attempts - 1) return;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        if (attempt === attempts - 1) throw lastError;
      }
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  async listTools(): Promise<RobloxMcpTool[]> {
    await this.ensureInitialized();
    const result = await this.rpc('tools/list', {});
    const error = errorFromRpc(result, 'MCP tools/list failed.');
    if (error) throw error;
    const obj = asRecord(result);
    this.tools = Array.isArray(obj.tools)
      ? obj.tools.filter((tool): tool is RobloxMcpTool => typeof tool === 'object' && tool !== null && typeof (tool as Record<string, unknown>).name === 'string')
      : [];
    return [...this.tools];
  }

  async call(request: RobloxMcpRequest): Promise<RobloxMcpResult> {
    await this.ensureInitialized();
    const args = { ...request.arguments };
    if (this.opts.studioId && args.studio_id === undefined) args.studio_id = this.opts.studioId;

    const result = await this.rpc('tools/call', { name: request.tool, arguments: args });
    const rpcError = errorFromRpc(result, 'MCP tool call failed.');
    if (rpcError) {
      return { ok: false, tool: request.tool, error: rpcError.message, raw: result };
    }

    const obj = asRecord(result);
    const isError = obj.isError === true;
    const text = extractText(result);
    return {
      ok: !isError,
      tool: request.tool,
      data: text || result,
      ...(isError ? { error: text || 'Roblox Studio MCP reported a tool error.' } : {}),
      raw: result,
    };
  }

  async close(): Promise<void> {
    this.failPending(new Error('MCP transport closed.'));
    try { this.proc?.kill(); } catch { /* best effort */ }
    this.proc = null;
    this.initialized = false;
    this.tools = [];
    this.buffer = '';
  }
}
