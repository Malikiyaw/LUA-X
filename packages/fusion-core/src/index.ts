export type Surface = 'code' | 'animation' | 'ui' | 'world' | 'project' | 'verification' | 'chat';
export type SessionStatus = 'idle' | 'planning' | 'working' | 'review' | 'verifying' | 'blocked' | 'ready';
export interface WorkspaceItem { id: string; surface: Surface; title: string; target?: string; dirty: boolean }
export interface WorkspaceSession { id: string; projectId: string; status: SessionStatus; activeSurface: Surface; items: WorkspaceItem[]; selectedItemId?: string }
export interface UnifiedTask { id: string; prompt: string; surfaces: Surface[]; acceptanceCriteria: string[]; requiresStudio: boolean }
export interface WorkspaceEvent { type: 'task' | 'selection' | 'status' | 'evidence'; message: string; at: string }

export function createWorkspace(projectId: string): WorkspaceSession {
  if (!projectId.trim()) throw new Error('projectId is required.');
  return { id: `workspace-${projectId}`, projectId, status: 'idle', activeSurface: 'project', items: [] };
}
export function registerItem(session: WorkspaceSession, item: WorkspaceItem): WorkspaceSession {
  if (session.items.some(x => x.id === item.id)) throw new Error(`Duplicate workspace item: ${item.id}`);
  return { ...session, items: [...session.items, item] };
}
export function routeTask(task: UnifiedTask): Surface[] {
  const unique = [...new Set(task.surfaces)];
  return unique.length ? unique : ['project'];
}
export function startTask(session: WorkspaceSession, task: UnifiedTask): WorkspaceSession {
  if (!task.prompt.trim()) throw new Error('Task prompt is required.');
  return { ...session, status: 'planning', activeSurface: routeTask(task)[0] };
}
export function setStatus(session: WorkspaceSession, status: SessionStatus): WorkspaceSession { return { ...session, status }; }
