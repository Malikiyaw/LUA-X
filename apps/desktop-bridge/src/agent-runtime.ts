import { RobloxMcpBridge, type RobloxMcpResult, type RobloxMcpTool } from '@lua-x/roblox-mcp-bridge';

export type BuildChange = {
  operation: string;
  target?: string;
  content?: string;
  reason?: string;
  risk?: string;
  dependsOn?: string[];
};

export type BuildPlan = {
  summary?: string;
  changes?: BuildChange[];
  acceptanceCriteria?: string[];
  verification?: string[];
  risks?: string[];
};

export type AgentEvent = {
  stage: 'inspect' | 'plan' | 'execute' | 'verify' | 'complete' | 'error';
  role: 'ORCHESTRATOR' | 'MCP' | 'VERIFY';
  message: string;
  at: number;
  tool?: string;
  ok?: boolean;
};

export type AgentRuntimeOptions = {
  maxRepairAttempts?: number;
  onEvent?: (event: AgentEvent) => void | Promise<void>;
};

function cleanPath(path: string): string {
  return path.trim().startsWith('game.') ? path.trim() : `game.${path.trim().replace(/^game\.?/, '')}`;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function orderedChanges(changes: BuildChange[]): BuildChange[] {
  const pending = changes.map((change, index) => ({ change, index }));
  const output: BuildChange[] = [];
  const applied = new Set<string>();
  const keyFor = (change: BuildChange, index: number) => change.target || `#${index}`;
  while (pending.length > 0) {
    const ready = pending.find(({ change }) => (change.dependsOn ?? []).every((dependency) => applied.has(dependency)));
    const item = ready ?? pending[0]!;
    pending.splice(pending.indexOf(item), 1);
    output.push(item.change);
    applied.add(keyFor(item.change, item.index));
  }
  return output;
}

function buildWholeFileEdit(tool: RobloxMcpTool | undefined, content: string): Record<string, unknown> {
  const schema = asRecord(tool?.inputSchema);
  const properties = asRecord(schema.properties);
  const editsSchema = asRecord(properties.edits);
  const items = asRecord(editsSchema.items);
  const editProperties = asRecord(items.properties);
  const edit: Record<string, unknown> = {};
  const names = Object.keys(editProperties);
  const set = (candidates: string[], value: unknown) => {
    const key = candidates.find((candidate) => names.includes(candidate));
    if (key) edit[key] = value;
  };
  set(['start_line', 'startLine', 'start'], 1);
  set(['end_line', 'endLine', 'end'], 2147483647);
  set(['new_text', 'newText', 'text', 'replacement', 'content'], content);
  if (Object.keys(edit).length === 0) {
    edit.start_line = 1;
    edit.end_line = 2147483647;
    edit.new_text = content;
  }
  return edit;
}

export class AgentRuntime {
  private readonly maxRepairAttempts: number;
  constructor(private readonly bridge: RobloxMcpBridge, private readonly options: AgentRuntimeOptions = {}) {
    this.maxRepairAttempts = Math.max(0, Math.min(3, options.maxRepairAttempts ?? 1));
  }

  private async event(partial: Omit<AgentEvent, 'at'>): Promise<void> {
    await this.options.onEvent?.({ ...partial, at: Date.now() });
  }

  private async call(tool: string, args: Record<string, unknown>, confirmed = false): Promise<RobloxMcpResult> {
    await this.event({ stage: 'execute', role: 'MCP', message: `Calling ${tool}`, tool });
    const result = await this.bridge.call({ tool, arguments: args }, confirmed);
    await this.event({ stage: 'execute', role: 'MCP', message: result.ok ? `${tool} completed` : `${tool} failed: ${result.error ?? 'unknown error'}`, tool, ok: result.ok });
    return result;
  }

  private async replaceScript(path: string, content: string, studioId?: string): Promise<RobloxMcpResult> {
    const tools = await this.bridge.listTools();
    const tool = tools.find((candidate) => candidate.name === 'multi_edit');
    const edit = buildWholeFileEdit(tool, content);
    return this.call('multi_edit', {
      path,
      edits: [edit],
      datamodel_type: 'Edit',
      ...(studioId ? { studio_id: studioId } : {}),
    }, true);
  }

  async inspect(): Promise<{ studios: RobloxMcpResult; tree: RobloxMcpResult; console: RobloxMcpResult }> {
    await this.event({ stage: 'inspect', role: 'ORCHESTRATOR', message: 'Inspecting connected Roblox Studio state' });
    const studios = await this.bridge.listStudios();
    const tree = await this.bridge.inspectProject({ depth: 6 });
    const console = await this.bridge.consoleOutput();
    return { studios, tree, console };
  }

  async executePlan(plan: BuildPlan, studioId?: string): Promise<{ ok: boolean; results: RobloxMcpResult[]; failed: number }> {
    const changes = orderedChanges(Array.isArray(plan.changes) ? plan.changes : []);
    const results: RobloxMcpResult[] = [];
    let failed = 0;
    await this.event({ stage: 'plan', role: 'ORCHESTRATOR', message: `Executing ${changes.length} planned changes${plan.summary ? `: ${plan.summary}` : ''}` });

    for (const change of changes) {
      const operation = change.operation;
      const target = change.target ? cleanPath(change.target) : '';
      let result: RobloxMcpResult;

      if ((operation === 'create_script' || operation === 'update_script') && target && typeof change.content === 'string') {
        result = await this.replaceScript(target, change.content, studioId);
      } else if (operation === 'delete_instance' && target) {
        result = await this.call('execute_luau', {
          datamodel_type: 'Edit',
          code: `local target = ${target}\nif target and target.Destroy then target:Destroy() end`,
          ...(studioId ? { studio_id: studioId } : {}),
        }, true);
      } else if (operation === 'execute_luau' && typeof change.content === 'string') {
        result = await this.call('execute_luau', { datamodel_type: 'Edit', code: change.content, ...(studioId ? { studio_id: studioId } : {}) }, true);
      } else if (operation === 'create_mesh') {
        result = await this.call('generate_mesh', { prompt: change.content ?? change.reason ?? target, ...(studioId ? { studio_id: studioId } : {}) }, true);
      } else if (operation === 'create_material') {
        result = await this.call('generate_material', { prompt: change.content ?? change.reason ?? target, ...(studioId ? { studio_id: studioId } : {}) }, true);
      } else if (operation === 'create_procedural_model') {
        result = await this.call('generate_procedural_model', { prompt: change.content ?? change.reason ?? target, ...(studioId ? { studio_id: studioId } : {}) }, true);
      } else if (operation === 'note') {
        result = { ok: true, tool: 'note', data: { target: change.target, reason: change.reason } };
      } else if (operation === 'create_instance' || operation === 'update_instance' || operation === 'create_ui' || operation === 'create_vfx' || operation === 'create_sound' || operation === 'create_animation') {
        result = { ok: false, tool: operation, error: 'This plan operation requires executable Luau content. Add an execute_luau change or use a provider prompt that emits executable Luau.' };
      } else {
        result = { ok: false, tool: operation || 'unknown', error: `Unsupported plan operation: ${operation}` };
      }
      results.push(result);
      if (!result.ok) failed += 1;
    }

    await this.event({ stage: 'verify', role: 'VERIFY', message: 'Reading Studio state and console after changes' });
    const state = await this.bridge.studioState(true);
    const console = await this.bridge.consoleOutput();
    results.push(state, console);
    const consoleText = JSON.stringify(console.data ?? '');
    const runtimeError = !console.ok || /error|exception|traceback/i.test(consoleText);
    if (runtimeError) failed += 1;

    if (failed > 0 && this.maxRepairAttempts > 0) {
      await this.event({ stage: 'verify', role: 'VERIFY', message: `Verification found ${failed} issue(s); repair is bounded to ${this.maxRepairAttempts} attempt(s)` });
    }

    const ok = failed === 0 && results.every((result) => result.ok);
    await this.event({ stage: ok ? 'complete' : 'error', role: 'ORCHESTRATOR', message: ok ? 'MCP execution and verification completed' : `Execution finished with ${failed} failure(s)`, ok });
    return { ok, results, failed };
  }
}
