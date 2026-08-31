import { spawn, type ChildProcess } from 'node:child_process';
import { platform } from 'node:os';
import type { RobloxMcpTransport, RobloxMcpRequest, RobloxMcpResult } from '@lua-x/roblox-mcp-bridge';

export type StdioTransportOptions = {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  studioId?: string;
};

function resolveDefault(): { command: string; args: string[] } {
  if (platform() === 'win32') return { command: 'cmd.exe', args: ['/c', '%LOCALAPPDATA%\\Roblox\\mcp.bat'] };
  return { command: '/Applications/RobloxStudio.app/Contents/MacOS/StudioMCP', args: [] };
}

export class StdioMcpTransport implements RobloxMcpTransport {
  private proc: ChildProcess | null = null;
  private buffer = '';
  private pending = new Map<string, { resolve: (v: RobloxMcpResult) => void; reject: (e: Error) => void }>();
  private seq = 0;
  constructor(private opts: StdioTransportOptions = {}) {}
  start(): void {
    if (this.proc) return;
    const def = resolveDefault();
    const command = this.opts.command ?? def.command;
    const args = this.opts.args ?? def.args;
    this.proc = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'], shell: platform() === 'win32', env: { ...process.env, ...(this.opts.env ?? {}) } as NodeJS.ProcessEnv });
    this.proc.stdout?.on('data', (chunk: Buffer) => this.onData(chunk.toString('utf8')));
    this.proc.stderr?.on('data', (chunk: Buffer) => console.error('[mcp:stderr]', chunk.toString('utf8').slice(0, 500)));
    this.proc.on('exit', (code) => { for (const { reject } of this.pending.values()) reject(new Error(`MCP exited ${code}`)); this.pending.clear(); });
  }
  private onData(chunk: string): void {
    this.buffer += chunk;
    let idx: number;
    while ((idx = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, idx).trim();
      this.buffer = this.buffer.slice(idx + 1);
      if (!line) continue;
      try {
        const msg = JSON.parse(line) as { id?: string; result?: unknown; error?: string; tool?: string };
        if (msg.id && this.pending.has(msg.id)) {
          const h = this.pending.get(msg.id)!; this.pending.delete(msg.id);
          if (msg.error) h.resolve({ ok: false, tool: msg.tool ?? 'unknown', error: msg.error });
          else h.resolve({ ok: true, tool: msg.tool ?? 'unknown', data: msg.result });
        }
      } catch { /* ignore */ }
    }
  }
  async call(request: RobloxMcpRequest): Promise<RobloxMcpResult> {
    this.start();
    if (!this.proc?.stdin?.writable) return { ok: false, tool: request.tool, error: 'MCP not started' };
    const id = String(++this.seq);
    const payload = JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name: request.tool, arguments: { ...request.arguments, ...(this.opts.studioId ? { studio_id: this.opts.studioId } : {}) } } });
    return new Promise<RobloxMcpResult>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.proc!.stdin!.write(payload + '\n', (err) => { if (err) { this.pending.delete(id); reject(err); } });
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); reject(new Error('MCP timeout')); } }, 25000);
    });
  }
  async close(): Promise<void> { try { this.proc?.kill(); } catch { /* */ } this.proc = null; }
}
