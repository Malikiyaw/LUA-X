export type RobloxScriptKind = 'Script' | 'LocalScript' | 'ModuleScript';
export type RobloxContainer = 'Server' | 'Client' | 'Shared' | 'Unknown';

export interface ProjectInstance {
  path: string;
  name: string;
  className: string;
  parentPath: string | null;
  childrenCount: number;
  attributes?: Record<string, unknown>;
}

export interface ScriptRecord {
  path: string;
  name: string;
  kind: RobloxScriptKind;
  container: RobloxContainer;
  sourceHash?: string;
  requires: string[];
  services: string[];
  remotes: string[];
  lineCount?: number;
}

export interface RemoteRecord {
  path: string;
  name: string;
  className: 'RemoteEvent' | 'RemoteFunction' | 'UnreliableRemoteEvent';
  location: string;
  callers: string[];
}

export interface AssetRecord {
  path: string;
  name: string;
  className: string;
  assetId?: number;
  uri?: string;
}

export interface DependencyEdge {
  from: string;
  to: string;
  kind: 'require' | 'service' | 'remote' | 'asset' | 'parent';
}

export interface ProjectIndex {
  schemaVersion: 1;
  generatedAt: string;
  rootName: string;
  instances: ProjectInstance[];
  scripts: ScriptRecord[];
  remotes: RemoteRecord[];
  assets: AssetRecord[];
  dependencies: DependencyEdge[];
  services: string[];
  containers: Record<RobloxContainer, string[]>;
  architectureSummary: string;
  warnings: string[];
}

export interface ProjectSnapshotInput {
  rootName: string;
  instances: ProjectInstance[];
  scripts?: ScriptRecord[];
  remotes?: RemoteRecord[];
  assets?: AssetRecord[];
  dependencies?: DependencyEdge[];
  services?: string[];
}

const SERVER_CONTAINERS = new Set(['ServerScriptService', 'ServerStorage']);
const CLIENT_CONTAINERS = new Set(['StarterGui', 'StarterPack', 'StarterPlayerScripts', 'StarterCharacterScripts', 'ReplicatedFirst']);
const SHARED_CONTAINERS = new Set(['ReplicatedStorage']);

function firstContainer(path: string): string | null {
  const parts = path.split('.');
  return parts.length > 1 ? parts[1] ?? null : null;
}

export function inferScriptContainer(path: string, kind: RobloxScriptKind): RobloxContainer {
  const container = firstContainer(path);
  if (container && SERVER_CONTAINERS.has(container)) return 'Server';
  if (container && CLIENT_CONTAINERS.has(container)) return 'Client';
  if (container && SHARED_CONTAINERS.has(container)) return 'Shared';
  if (kind === 'LocalScript') return 'Client';
  return kind === 'ModuleScript' ? 'Unknown' : 'Unknown';
}

export function buildProjectIndex(input: ProjectSnapshotInput): ProjectIndex {
  const scripts = (input.scripts ?? []).map((script) => ({
    ...script,
    container: script.container === 'Unknown' ? inferScriptContainer(script.path, script.kind) : script.container,
    requires: [...new Set(script.requires)],
    services: [...new Set(script.services)],
    remotes: [...new Set(script.remotes)],
  }));

  const remotes = input.remotes ?? [];
  const assets = input.assets ?? [];
  const dependencies = [...(input.dependencies ?? [])];
  const services = [...new Set(input.services ?? [])].sort();
  const containers: Record<RobloxContainer, string[]> = { Server: [], Client: [], Shared: [], Unknown: [] };

  for (const script of scripts) containers[script.container].push(script.path);

  for (const script of scripts) {
    for (const target of script.requires) dependencies.push({ from: script.path, to: target, kind: 'require' });
    for (const service of script.services) dependencies.push({ from: script.path, to: `game:GetService(${service})`, kind: 'service' });
    for (const remote of script.remotes) dependencies.push({ from: script.path, to: remote, kind: 'remote' });
  }

  const warnings: string[] = [];
  for (const script of scripts) {
    if (script.kind === 'LocalScript' && script.container === 'Server') {
      warnings.push(`${script.path}: LocalScript appears under a server-only container.`);
    }
  }

  const serverScripts = scripts.filter((s) => s.container === 'Server').length;
  const clientScripts = scripts.filter((s) => s.container === 'Client').length;
  const sharedScripts = scripts.filter((s) => s.container === 'Shared').length;
  const architectureSummary = `Indexed ${input.instances.length} instances, ${scripts.length} scripts (${serverScripts} server, ${clientScripts} client, ${sharedScripts} shared), ${remotes.length} remotes, and ${assets.length} assets.`;

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    rootName: input.rootName,
    instances: [...input.instances],
    scripts,
    remotes: [...remotes],
    assets: [...assets],
    dependencies: dedupeEdges(dependencies),
    services,
    containers,
    architectureSummary,
    warnings,
  };
}

function dedupeEdges(edges: DependencyEdge[]): DependencyEdge[] {
  const seen = new Set<string>();
  return edges.filter((edge) => {
    const key = `${edge.from}\0${edge.to}\0${edge.kind}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function queryProjectIndex(index: ProjectIndex, query: string): {
  instances: ProjectInstance[];
  scripts: ScriptRecord[];
  remotes: RemoteRecord[];
  assets: AssetRecord[];
} {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return { instances: [], scripts: [], remotes: [], assets: [] };
  const match = (value: string) => value.toLowerCase().includes(normalized);
  return {
    instances: index.instances.filter((item) => match(item.path) || match(item.name) || match(item.className)),
    scripts: index.scripts.filter((item) => match(item.path) || match(item.name) || item.requires.some(match) || item.remotes.some(match)),
    remotes: index.remotes.filter((item) => match(item.path) || match(item.name) || item.callers.some(match)),
    assets: index.assets.filter((item) => match(item.path) || match(item.name) || String(item.assetId ?? '').includes(normalized)),
  };
}

export function getIndexStats(index: ProjectIndex) {
  return {
    instances: index.instances.length,
    scripts: index.scripts.length,
    serverScripts: index.scripts.filter((s) => s.container === 'Server').length,
    clientScripts: index.scripts.filter((s) => s.container === 'Client').length,
    sharedScripts: index.scripts.filter((s) => s.container === 'Shared').length,
    remotes: index.remotes.length,
    assets: index.assets.length,
    dependencies: index.dependencies.length,
    services: index.services.length,
    warnings: index.warnings.length,
  };
}
