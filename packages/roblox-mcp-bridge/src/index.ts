export type DataModelType = 'Edit' | 'Client' | 'Server';

export type RobloxStudioState = {
  studioId: string;
  name: string;
  active: boolean;
  playState?: string;
};

export type RobloxMcpRequest = {
  tool: string;
  arguments: Record<string, unknown>;
};

export type RobloxMcpResult = {
  ok: boolean;
  tool: string;
  data?: unknown;
  error?: string;
};

export interface RobloxMcpTransport {
  call(request: RobloxMcpRequest): Promise<RobloxMcpResult>;
  close?(): Promise<void>;
}

export type BridgeConfig = {
  transport: RobloxMcpTransport;
  requireConfirmation?: boolean;
};

const READ_TOOLS = new Set([
  'get_studio_state',
  'list_roblox_studios',
  'search_game_tree',
  'inspect_instance',
  'script_read',
  'script_search',
  'script_grep',
  'get_console_output',
  'screen_capture',
]);

const WRITE_TOOLS = new Set([
  'multi_edit',
  'execute_luau',
  'insert_asset',
  'upload_image',
  'store_image',
  'search_asset',
  'generate_mesh',
  'generate_material',
  'generate_procedural_model',
  'wait_job_finished',
  'start_stop_play',
  'character_navigation',
  'user_keyboard_input',
  'user_mouse_input',
  'set_active_studio',
]);

export class RobloxMcpBridge {
  constructor(private readonly config: BridgeConfig) {}

  async call(request: RobloxMcpRequest, confirmed = false): Promise<RobloxMcpResult> {
    const category = this.classify(request.tool);

    if (category === 'unknown') {
      return { ok: false, tool: request.tool, error: `Unsupported Studio MCP tool: ${request.tool}` };
    }

    if (category === 'write' && this.config.requireConfirmation && !confirmed) {
      return {
        ok: false,
        tool: request.tool,
        error: 'Confirmation required before a mutating Studio operation.',
      };
    }

    return this.config.transport.call(request);
  }

  classify(tool: string): 'read' | 'write' | 'unknown' {
    if (READ_TOOLS.has(tool)) return 'read';
    if (WRITE_TOOLS.has(tool)) return 'write';
    return 'unknown';
  }

  async inspectProject(options: Record<string, unknown> = {}): Promise<RobloxMcpResult> {
    return this.call({ tool: 'search_game_tree', arguments: options });
  }

  async readScript(path: string, startLine?: number, endLine?: number): Promise<RobloxMcpResult> {
    const arguments_: Record<string, unknown> = { path };
    if (startLine !== undefined) arguments_.start_line = startLine;
    if (endLine !== undefined) arguments_.end_line = endLine;
    return this.call({ tool: 'script_read', arguments: arguments_ });
  }

  async searchScripts(query: string): Promise<RobloxMcpResult> {
    return this.call({ tool: 'script_search', arguments: { query } });
  }

  async grepScripts(pattern: string): Promise<RobloxMcpResult> {
    return this.call({ tool: 'script_grep', arguments: { pattern } });
  }

  async inspectInstance(path: string): Promise<RobloxMcpResult> {
    return this.call({ tool: 'inspect_instance', arguments: { path } });
  }

  async studioState(): Promise<RobloxMcpResult> {
    return this.call({ tool: 'get_studio_state', arguments: {} });
  }

  async consoleOutput(): Promise<RobloxMcpResult> {
    return this.call({ tool: 'get_console_output', arguments: {} });
  }

  async editScript(path: string, edits: unknown[], confirmed = false): Promise<RobloxMcpResult> {
    return this.call(
      {
        tool: 'multi_edit',
        arguments: { path, edits, datamodel_type: 'Edit' satisfies DataModelType },
      },
      confirmed,
    );
  }

  async executeLuau(code: string, datamodelType: DataModelType, confirmed = false): Promise<RobloxMcpResult> {
    return this.call(
      { tool: 'execute_luau', arguments: { code, datamodel_type: datamodelType } },
      confirmed,
    );
  }

  async play(action: 'start' | 'stop', confirmed = false): Promise<RobloxMcpResult> {
    return this.call(
      { tool: 'start_stop_play', arguments: { action } },
      confirmed,
    );
  }
}

export function createNoopTransport(): RobloxMcpTransport {
  return {
    async call(request) {
      return {
        ok: false,
        tool: request.tool,
        error: 'No Roblox Studio MCP transport is connected. Connect a trusted MCP client to an open Studio session.',
      };
    },
  };
}
