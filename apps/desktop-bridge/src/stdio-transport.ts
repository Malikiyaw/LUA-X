import { spawn, type ChildProcess } from 'node:child_process';
import { platform } from 'node:os';
import type { RobloxMcpTool, RobloxMcpTransport, RobloxMcpRequest, RobloxMcpResult } from '@lua-x/roblox-mcp-bridge';

export type StdioTransportOptions = {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  studioId?: string;
  requestTimeoutMs?: number;
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

function resolveDefault(): { command: string; args: string[] } {
  if (platform() === 'win32') return { command: 'cmd.exe', args: ['/c', '%LOCALAPPDATA%\\Roblox\\mcp.bat'] };
  return { command: '/Applications/RobloxStudio.app/Contents/MacOS/StudioMCP', args: [] };
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

export class StdioMcpTransport implements RobloxMcpTransport {
  private proc: ChildProcess | null = null;
  private buffer = '';
  private pending = new Map<string, Pending>();
  private seq = 0;
  private initialized = false;
  private tools: RobloxMcpTool[] = [];

  constructor(private readonly opts: StdioTransportOptions = {}) {}

  start(): void {
    if (this.proc && !this.proc.killed) return;
    const def = resolveDefault();
    const command = this.opts.command ?? def.command;
    const args = this.opts.args ?? def.args;

    this.proc = spawn(command, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: platform() === 'win32',
      env: { ...process.env, ...(this.opts.env ?? {}) } as NodeJS.ProcessEnv,
    });

    this.proc.stdout?.on('data', (chunk: Buffer) => this.onData(chunk.toString('utf8')));
    this.proc.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf8').trim();
      if (text) console.error('[LUA-X MCP]', text.slice(0, 1000));
    });
    this.proc.on('error', (error) => this.failPending(error instanceof Error ? error : new Error(String(error))));
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
    if (!this.proc?.stdin?.writable) throw new Error('Roblox Studio MCP process is not writable.');
    const id = String(++this.seq);
    const payload = JSON.stringify({ jsonrpc: '2.0', id, method, params });
    const timeoutMs = this.opts.requestTimeoutMs ?? 30000;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`MCP request timed out: ${method}`));
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

  private async ensureInitialized(): Promise<void> {
    if (this.initialized) return;
    const result = await this.rpc('initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'LUA-X', version: '0.11.0-alpha' },
    });
    const error = asRecord(result).__rpcError;
    if (error) throw new Error(String(asRecord(error).message ?? 'MCP initialize failed.'));
    await this.rpc('notifications/initialized', {});
    this.initialized = true;
  }

  async connect(): Promise<void> {
    await this.ensureInitialized();
    await this.listTools();
  }

  async listTools(): Promise<RobloxMcpTool[]> {
    await this.ensureInitialized();
    const result = await this.rpc('tools/list', {});
    const error = asRecord(result).__rpcError;
    if (error) throw new Error(String(asRecord(error).message ?? 'MCP tools/list failed.'));
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
    const obj = asRecord(result);
    const rpcError = asRecord(obj.__rpcError);
    if (Object.keys(rpcError).length > 0) {
      return { ok: false, tool: request.tool, error: String(rpcError.message ?? 'MCP tool call failed.'), raw: result };
    }

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
  }
}
