export type BuildStatus = 'draft' | 'planning' | 'awaiting_approval' | 'executing' | 'verifying' | 'repairing' | 'completed' | 'blocked' | 'failed';
export type WorkKind = 'architecture' | 'code' | 'animation' | 'ui' | 'world' | 'security' | 'performance' | 'verification';

export interface Goal { id: string; description: string; priority: 'critical' | 'high' | 'medium' | 'low'; acceptanceCriteria: string[] }
export interface WorkItem { id: string; kind: WorkKind; title: string; description: string; dependsOn: string[]; risk: 'low' | 'medium' | 'high' | 'critical'; acceptanceCriteria: string[] }
export interface BuildPlan { id: string; goalId: string; work: WorkItem[]; generatedAt: string }
export interface BuildEvent { at: string; status: BuildStatus; workItemId?: string; message: string; evidence?: string[] }
export interface BuildSession { id: string; goal: Goal; status: BuildStatus; plan?: BuildPlan; events: BuildEvent[]; repairAttempts: number; maxRepairAttempts: number }

export function createSession(goal: Goal, maxRepairAttempts = 3): BuildSession {
  if (!goal.description.trim()) throw new Error('A build goal is required.');
  if (goal.acceptanceCriteria.length === 0) throw new Error('At least one acceptance criterion is required.');
  return { id: `build-${goal.id}`, goal, status: 'draft', events: [], repairAttempts: 0, maxRepairAttempts };
}

export function setPlan(session: BuildSession, plan: BuildPlan): BuildSession {
  const ids = new Set<string>();
  for (const item of plan.work) {
    if (ids.has(item.id)) throw new Error(`Duplicate work item: ${item.id}`);
    ids.add(item.id);
    if (item.dependsOn.includes(item.id)) throw new Error(`Work item cannot depend on itself: ${item.id}`);
    for (const dep of item.dependsOn) if (!plan.work.some(w => w.id === dep)) throw new Error(`Missing dependency ${dep} for ${item.id}`);
  }
  return { ...session, plan, status: 'awaiting_approval', events: [...session.events, { at: new Date().toISOString(), status: 'awaiting_approval', message: 'Build plan prepared for approval.' }] };
}

export function nextExecutableWork(session: BuildSession, completed: Set<string>): WorkItem[] {
  if (!session.plan) return [];
  return session.plan.work.filter(w => !completed.has(w.id) && w.dependsOn.every(d => completed.has(d)));
}

export function beginExecution(session: BuildSession): BuildSession {
  if (!session.plan) throw new Error('Cannot execute without a plan.');
  if (session.status !== 'awaiting_approval') throw new Error(`Cannot execute from status ${session.status}.`);
  return { ...session, status: 'executing', events: [...session.events, { at: new Date().toISOString(), status: 'executing', message: 'Approved build execution started.' }] };
}

export function requestRepair(session: BuildSession, reason: string, recoverable: boolean): BuildSession {
  if (!recoverable || session.repairAttempts >= session.maxRepairAttempts) {
    return { ...session, status: 'blocked', events: [...session.events, { at: new Date().toISOString(), status: 'blocked', message: `Repair stopped: ${reason}` }] };
  }
  return { ...session, status: 'repairing', repairAttempts: session.repairAttempts + 1, events: [...session.events, { at: new Date().toISOString(), status: 'repairing', message: `Targeted repair ${session.repairAttempts + 1}: ${reason}` }] };
}

export function complete(session: BuildSession, evidence: string[]): BuildSession {
  if (evidence.length === 0) throw new Error('Completion requires evidence.');
  return { ...session, status: 'completed', events: [...session.events, { at: new Date().toISOString(), status: 'completed', message: 'Build completed with verification evidence.', evidence }] };
}
