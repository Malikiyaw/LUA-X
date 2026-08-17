export type Role = 'owner' | 'admin' | 'developer' | 'designer' | 'reviewer' | 'viewer';
export interface Member { userId: string; role: Role }
export interface ProjectRecord { id: string; name: string; ownerId: string; members: Member[]; createdAt: string; updatedAt: string }
export interface AuditEvent { id: string; projectId: string; actorId: string; action: string; target?: string; metadata?: Record<string, string>; at: string }
export interface Snapshot { id: string; projectId: string; label: string; createdAt: string; parentId?: string; changeIds: string[] }
export interface Usage { projectId: string; period: string; requests: number; buildRuns: number; verificationRuns: number }

const roleRank: Record<Role, number> = { viewer: 0, reviewer: 1, designer: 2, developer: 3, admin: 4, owner: 5 };

export function can(member: Member, required: Role): boolean {
  return roleRank[member.role] >= roleRank[required];
}

export function createProject(id: string, name: string, ownerId: string): ProjectRecord {
  if (!id.trim() || !name.trim() || !ownerId.trim()) throw new Error('Project id, name, and owner are required.');
  const now = new Date().toISOString();
  return {
    id,
    name,
    ownerId,
    members: [{ userId: ownerId, role: 'owner' }],
    createdAt: now,
    updatedAt: now,
  };
}

export function addMember(project: ProjectRecord, actor: Member, member: Member): ProjectRecord {
  if (!can(actor, 'admin')) throw new Error('Admin permission required.');
  if (project.members.some((m) => m.userId === member.userId)) throw new Error('Member already exists.');
  return { ...project, members: [...project.members, member], updatedAt: new Date().toISOString() };
}

export function recordAudit(projectId: string, actorId: string, action: string, target?: string): AuditEvent {
  const base: AuditEvent = {
    id: `audit-${crypto.randomUUID()}`,
    projectId,
    actorId,
    action,
    at: new Date().toISOString(),
  };
  return target === undefined ? base : { ...base, target };
}

export function createSnapshot(projectId: string, label: string, changeIds: string[], parentId?: string): Snapshot {
  if (!changeIds.length) throw new Error('Snapshot must contain at least one change.');
  const base: Snapshot = {
    id: `snap-${crypto.randomUUID()}`,
    projectId,
    label,
    createdAt: new Date().toISOString(),
    changeIds,
  };
  return parentId === undefined ? base : { ...base, parentId };
}
