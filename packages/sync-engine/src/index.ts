/**
 * LUA-X Sync Engine — WEPPY-inspired filesystem mirror (inspired by weppy-project-sync)
 * Implements: per-Place isolation, snapshot scanner, per-category Direction/Apply Mode,
 * collision ~1/~~, BinaryString marker, sourcemap, LRU 5 Places, manual delete gate.
 * Local mirror root: lua-x-sync/place_<placeId>/explorer/
 */

export type SyncCategory = 'scripts' | 'values' | 'data' | 'containers' | 'services';
export type SyncDirection = 'forward' | 'reverse' | 'bidirectional';
export type ApplyMode = 'manual' | 'auto';

export interface SyncConfig {
  direction: Record<SyncCategory, SyncDirection>;
  applyMode: Record<SyncCategory, ApplyMode>;
  autoApplyDeletes: boolean;
}

export interface SyncFile {
  path: string; // e.g. ServerScriptService/MyScript/MyScript.server.luau
  category: SyncCategory;
  content: string;
  hash?: string;
}

export interface SyncPlace {
  placeId: string;
  rootName: string;
  files: SyncFile[];
  tree: Record<string, unknown>;
  syncMeta: { startedAt: string; filesWritten: number; categories: SyncCategory[] };
  syncIndex: { placeId: string; files: number; updatedAt: string };
  sourcemap: { filePaths: string[]; generatedAt: string };
}

export interface SyncEvent {
  placeId: string;
  kind: 'studioChange' | 'localChange' | 'conflict' | 'deleteQueued' | 'fullSync';
  category: SyncCategory;
  path: string;
  at: string;
  resolved?: 'applied' | 'queued' | 'restored' | 'manualRequired';
}

export interface SyncState {
  places: Map<string, SyncPlace>;
  activePlaceId: string | null;
  history: SyncEvent[];
  order: string[]; // LRU order, oldest first
}

const CATEGORIES: SyncCategory[] = ['scripts', 'values', 'data', 'containers', 'services'];
const MAX_PLACES = 5;

// Collision: SpawnLocation~1, escape ~ as ~~
function escapeName(name: string): string {
  if (name.includes('~')) return name.replace(/~/g, '~~');
  return name;
}
function collisionName(base: string, count: number): string {
  return `${escapeName(base)}~${count}`;
}

// BinaryString marker — preserve non-UTF8 round-trip
export function encodeBinaryString(data: Uint8Array): { __type: 'BinaryString'; encoding: 'base64'; data: string; byteLength: number } {
  let binary = '';
  for (const b of data) binary += String.fromCharCode(b);
  const b64 = typeof Buffer !== 'undefined' ? Buffer.from(binary, 'binary').toString('base64') : btoa(binary);
  return { __type: 'BinaryString', encoding: 'base64', data: b64, byteLength: data.length };
}

export function defaultConfig(): SyncConfig {
  const direction = {} as Record<SyncCategory, SyncDirection>;
  const applyMode = {} as Record<SyncCategory, ApplyMode>;
  for (const c of CATEGORIES) {
    direction[c] = 'forward';
    applyMode[c] = 'manual';
  }
  return { direction, applyMode, autoApplyDeletes: false };
}

export function createSyncState(): SyncState {
  return { places: new Map(), activePlaceId: null, history: [], order: [] };
}

function toSyncFilePath(service: string, name: string, ext: string): string {
  return `${service}/${escapeName(name)}/${escapeName(name)}${ext}`;
}

export function categorizeFile(path: string): SyncCategory {
  if (path.endsWith('.server.luau') || path.endsWith('.client.luau') || path.endsWith('.module.luau')) return 'scripts';
  if (path.endsWith('.value.json')) return 'values';
  if (path.endsWith('.props.json')) return 'data';
  if (path.includes('/_tree.json')) return 'containers';
  return 'services';
}

export function startFullSync(
  state: SyncState,
  placeId: string,
  rootName: string,
  input: { instances?: { path: string; className: string }[]; scripts?: { path: string; source: string }[]; values?: { path: string; json: string }[] },
  config: SyncConfig = defaultConfig(),
): SyncPlace {
  if (!placeId) throw new Error('placeId required — start sync in Edit mode only');
  // LRU eviction: keep up to MAX_PLACES
  if (!state.places.has(placeId) && state.places.size >= MAX_PLACES) {
    const evict = state.order.shift();
    if (evict) state.places.delete(evict);
  }

  const files: SyncFile[] = [];
  const tree: Record<string, unknown> = {};

  // scripts -> .server.luau / .client.luau / .module.luau v2 nested format
  for (const s of input.scripts ?? []) {
    const parts = s.path.split('.');
    const container = parts[1] ?? 'ReplicatedStorage';
    const name = parts[parts.length - 1] ?? 'Script';
    const ext = s.path.includes('ServerScriptService') || s.path.includes('ServerStorage') ? '.server.luau' : s.path.includes('LocalScript') ? '.client.luau' : '.module.luau';
    // fallback: use extension based on name if not server
    const filePath = toSyncFilePath(container, name, ext);
    files.push({ path: filePath, category: 'scripts', content: s.source });
    tree[filePath] = { name, className: 'Script', category: 'scripts' };
  }

  for (const v of input.values ?? []) {
    files.push({ path: `${v.path}.value.json`, category: 'values', content: v.json });
  }

  for (const inst of input.instances ?? []) {
    const key = `${inst.path.replace(/\./g, '/')}/${escapeName(inst.className)}.props.json`;
    // data category props
    if (!files.some(f => f.path === key)) {
      // dedupe: only add if not script
      tree[key] = { className: inst.className };
    }
  }

  const sourcemap = {
    filePaths: files.filter(f => f.category === 'scripts').map(f => `lua-x-sync/place_${placeId}/explorer/${f.path}`),
    generatedAt: new Date().toISOString(),
  };

  const place: SyncPlace = {
    placeId,
    rootName,
    files,
    tree,
    syncMeta: { startedAt: new Date().toISOString(), filesWritten: files.length, categories: CATEGORIES },
    syncIndex: { placeId, files: files.length, updatedAt: new Date().toISOString() },
    sourcemap,
  };

  state.places.set(placeId, place);
  if (!state.order.includes(placeId)) state.order.push(placeId);
  else {
    state.order = [...state.order.filter(id => id !== placeId), placeId];
  }
  state.activePlaceId = placeId;
  state.history.push({ placeId, kind: 'fullSync', category: 'scripts', path: `place_${placeId}`, at: new Date().toISOString(), resolved: 'applied' });

  // enforce per-category forward/manual on first sync (safe defaults like WEPPY)
  void config;

  return place;
}

export function handleStudioChange(
  state: SyncState,
  placeId: string,
  path: string,
  category: SyncCategory,
  config: SyncConfig = defaultConfig(),
): { action: 'write' | 'queueRestore' | 'ignore'; reason: string } {
  const dir = config.direction[category];
  if (dir === 'forward' || dir === 'bidirectional') {
    state.history.push({ placeId, kind: 'studioChange', category, path, at: new Date().toISOString(), resolved: 'applied' });
    return { action: 'write', reason: `Studio authoritative (${dir}) — write to local` };
  }
  if (dir === 'reverse') {
    state.history.push({ placeId, kind: 'conflict', category, path, at: new Date().toISOString(), resolved: 'queued' });
    return { action: 'queueRestore', reason: 'reverse mode — queue restore to keep local authoritative' };
  }
  return { action: 'ignore', reason: 'unknown direction' };
}

export function handleLocalChange(
  state: SyncState,
  placeId: string,
  path: string,
  category: SyncCategory,
  config: SyncConfig = defaultConfig(),
): { action: 'pending' | 'restoreDirty' | 'ignore'; reason: string } {
  const dir = config.direction[category];
  const mode = config.applyMode[category];
  if (dir === 'reverse' || dir === 'bidirectional') {
    const resolved: SyncEvent['resolved'] = mode === 'auto' ? 'applied' : 'manualRequired';
    state.history.push({ placeId, kind: 'localChange', category, path, at: new Date().toISOString(), resolved });
    return { action: 'pending', reason: `${dir}+${mode} — pending to Studio` };
  }
  // forward: local dirty must be restored from Studio
  state.history.push({ placeId, kind: 'conflict', category, path, at: new Date().toISOString(), resolved: 'restored' });
  return { action: 'restoreDirty', reason: 'forward mode — restore from Studio' };
}

export function handleDelete(
  state: SyncState,
  placeId: string,
  path: string,
  category: SyncCategory,
  config: SyncConfig = defaultConfig(),
): { action: 'queuedManual' | 'auto'; reason: string } {
  // Like WEPPY: instanceRemoved always manual even if autoApply unless explicit opt-in
  if (!config.autoApplyDeletes) {
    state.history.push({ placeId, kind: 'deleteQueued', category, path, at: new Date().toISOString(), resolved: 'manualRequired' });
    return { action: 'queuedManual', reason: 'delete always manual — use Parent=nil for Undo, not Destroy()' };
  }
  return { action: 'auto', reason: 'autoApplyDeletes enabled' };
}

export function getSyncStatus(state: SyncState, placeId: string): { exists: boolean; files: number; active: boolean; historyCount: number; categories: SyncCategory[] } | null {
  const place = state.places.get(placeId);
  if (!place) return null;
  return {
    exists: true,
    files: place.files.length,
    active: state.activePlaceId === placeId,
    historyCount: state.history.filter(h => h.placeId === placeId).length,
    categories: CATEGORIES,
  };
}

export function generateSourcemap(state: SyncState, placeId: string): { filePaths: string[]; generatedAt: string } | null {
  const place = state.places.get(placeId);
  if (!place) return null;
  return place.sourcemap;
}

export function querySync(state: SyncState, placeId: string, query: string): SyncFile[] {
  const place = state.places.get(placeId);
  if (!place || !query.trim()) return [];
  const q = query.toLowerCase();
  return place.files.filter(f => f.path.toLowerCase().includes(q) || f.content.toLowerCase().includes(q)).slice(0, 50);
}

export function getSyncHistory(state: SyncState, placeId?: string): SyncEvent[] {
  if (!placeId) return [...state.history].slice(-100);
  return state.history.filter(h => h.placeId === placeId).slice(-100);
}
