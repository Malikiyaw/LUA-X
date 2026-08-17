export interface AIGenerateRequest {
  prompt: string;
  projectId?: string;
  context?: {
    relevantFiles?: string[];
    relevantInstances?: string[];
    architecture?: string;
    constraints?: string[];
  };
}

export interface ChangeProposal {
  operation: 'create_script' | 'update_script' | 'create_instance' | 'update_instance' | 'delete_instance' | 'note';
  target: string;
  content?: string;
  reason: string;
  risk: 'low' | 'medium' | 'high' | 'critical';
}

export interface AIPlan {
  summary: string;
  assumptions: string[];
  changes: ChangeProposal[];
  acceptanceCriteria: string[];
  verification: string[];
  risks: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null; }

export function parseAIPlan(text: string): AIPlan {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  let parsed: unknown;
  try { parsed = JSON.parse(cleaned); } catch { throw new Error('AI returned non-JSON output.'); }
  if (!isRecord(parsed)) throw new Error('AI plan must be an object.');
  const summary = parsed.summary;
  const assumptions = parsed.assumptions;
  const changes = parsed.changes;
  const acceptanceCriteria = parsed.acceptanceCriteria;
  const verification = parsed.verification;
  const risks = parsed.risks;
  if (typeof summary !== 'string' || !summary.trim()) throw new Error('AI plan summary is required.');
  if (!Array.isArray(assumptions) || !assumptions.every(x => typeof x === 'string')) throw new Error('AI plan assumptions are invalid.');
  if (!Array.isArray(changes)) throw new Error('AI plan changes are invalid.');
  if (!Array.isArray(acceptanceCriteria) || !acceptanceCriteria.every(x => typeof x === 'string')) throw new Error('AI plan acceptanceCriteria are invalid.');
  if (!Array.isArray(verification) || !verification.every(x => typeof x === 'string')) throw new Error('AI plan verification is invalid.');
  if (!Array.isArray(risks) || !risks.every(x => typeof x === 'string')) throw new Error('AI plan risks are invalid.');
  const allowed = new Set(['create_script','update_script','create_instance','update_instance','delete_instance','note']);
  const validated: ChangeProposal[] = [];
  for (const item of changes) {
    if (!isRecord(item) || typeof item.operation !== 'string' || !allowed.has(item.operation) || typeof item.target !== 'string' || !item.target.trim() || typeof item.reason !== 'string' || !item.reason.trim() || typeof item.risk !== 'string' || !['low','medium','high','critical'].includes(item.risk)) {
      throw new Error('AI plan contains an invalid change proposal.');
    }
    if (item.content !== undefined && typeof item.content !== 'string') throw new Error('Change proposal content must be a string.');
    validated.push({ operation: item.operation as ChangeProposal['operation'], target: item.target, content: item.content as string | undefined, reason: item.reason, risk: item.risk as ChangeProposal['risk'] });
  }
  return { summary, assumptions, changes: validated, acceptanceCriteria, verification, risks };
}
