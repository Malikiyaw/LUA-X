import type { ExecutionBrief } from "@lua-x/shared";

export type OperationKind = "create-script" | "replace-script" | "edit-script" | "delete-script";
export type RiskLevel = "low" | "medium" | "high" | "critical";
export interface CodeOperation { readonly id: string; readonly kind: OperationKind; readonly target: string; readonly datamodelType: "Edit"; readonly content?: string; readonly expectedHash?: string; readonly reason: string; readonly risk: RiskLevel; }
export interface CodeChangeSet { readonly id: string; readonly projectId: string | null; readonly summary: string; readonly operations: readonly CodeOperation[]; readonly acceptanceCriteria: readonly string[]; readonly verification: readonly string[]; }
export interface ExecutionEvidence { readonly operationId: string; readonly ok: boolean; readonly message: string; readonly tool?: string; }
export interface ExecutionResult { readonly changeSetId: string; readonly status: "applied" | "blocked" | "failed"; readonly evidence: readonly ExecutionEvidence[]; }
export interface CodeExecutionAdapter { readScript(target: string): Promise<{ content: string; hash?: string }>; applyOperation(operation: CodeOperation): Promise<ExecutionEvidence>; }
export interface ApprovalPolicy { readonly requireApprovalFor: readonly RiskLevel[]; }
const DEFAULT_POLICY: ApprovalPolicy = { requireApprovalFor: ["medium", "high", "critical"] };
function stableId(input: string): string { let hash = 2166136261; for (let i = 0; i < input.length; i += 1) { hash ^= input.charCodeAt(i); hash = Math.imul(hash, 16777619); } return `cs_${(hash >>> 0).toString(16).padStart(8, "0")}`; }
export function createChangeSet(brief: ExecutionBrief, operations: readonly CodeOperation[]): CodeChangeSet { return { id: stableId(JSON.stringify({ projectId: brief.project.projectId, operations })), projectId: brief.project.projectId, summary: brief.objective.summary, operations, acceptanceCriteria: brief.acceptanceCriteria, verification: brief.verification }; }
export function requiresApproval(operation: CodeOperation, policy: ApprovalPolicy = DEFAULT_POLICY): boolean { return policy.requireApprovalFor.includes(operation.risk); }
export interface ApplyOptions { readonly approvedChangeSetId?: string; readonly policy?: ApprovalPolicy; readonly allowDelete?: boolean; }
export async function applyChangeSet(changeSet: CodeChangeSet, adapter: CodeExecutionAdapter, options: ApplyOptions = {}): Promise<ExecutionResult> {
  if (changeSet.operations.length === 0) return { changeSetId: changeSet.id, status: "blocked", evidence: [{ operationId: "none", ok: false, message: "Change set contains no operations." }] };
  if (options.approvedChangeSetId !== changeSet.id) { const blocked = changeSet.operations.find((operation) => requiresApproval(operation, options.policy)); if (blocked) return { changeSetId: changeSet.id, status: "blocked", evidence: [{ operationId: blocked.id, ok: false, message: `Approval required for ${blocked.risk}-risk operation.` }] }; }
  const evidence: ExecutionEvidence[] = [];
  for (const operation of changeSet.operations) {
    if (operation.kind === "delete-script" && !options.allowDelete) { evidence.push({ operationId: operation.id, ok: false, message: "Script deletion is disabled by default." }); return { changeSetId: changeSet.id, status: "blocked", evidence }; }
    if (operation.kind === "replace-script" && operation.expectedHash) { const current = await adapter.readScript(operation.target); if (current.hash && current.hash !== operation.expectedHash) { evidence.push({ operationId: operation.id, ok: false, message: "Target changed since the change set was created; refusing to overwrite." }); return { changeSetId: changeSet.id, status: "blocked", evidence }; } }
    const result = await adapter.applyOperation(operation); evidence.push(result); if (!result.ok) return { changeSetId: changeSet.id, status: "failed", evidence };
  }
  return { changeSetId: changeSet.id, status: "applied", evidence };
}
export class DryRunAdapter implements CodeExecutionAdapter {
  readonly applied: CodeOperation[] = [];
  async readScript(): Promise<{ content: string; hash?: string }> { return { content: "" }; }
  async applyOperation(operation: CodeOperation): Promise<ExecutionEvidence> { this.applied.push(operation); return { operationId: operation.id, ok: true, message: `Dry-run accepted ${operation.kind} for ${operation.target}.`, tool: "dry-run" }; }
}
