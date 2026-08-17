import type { AgentRole } from "@lua-x/shared";
export type ChangeOperation = "create" | "update" | "delete" | "move" | "configure";
export type RiskLevel = "low" | "medium" | "high";
export interface ChangeProposal { readonly id: string; readonly operation: ChangeOperation; readonly target: string; readonly reason: string; readonly agent: AgentRole; readonly risk: RiskLevel; readonly dependsOn: readonly string[]; readonly expectedEffect: string; readonly reversible: boolean; }
export type ChangeProposalInput = Omit<ChangeProposal, "id">;
export interface ChangeSet { readonly id: string; readonly title: string; readonly proposals: readonly ChangeProposal[]; readonly createdAt: string; readonly status: "draft" | "approved" | "applied" | "rejected" | "rolled_back"; }
function stableId(input: string): string { let hash = 2166136261; for (let i = 0; i < input.length; i += 1) { hash ^= input.charCodeAt(i); hash = Math.imul(hash, 16777619); } return `chg_${(hash >>> 0).toString(16).padStart(8, "0")}`; }
export function createChangeSet(title: string, proposals: readonly ChangeProposalInput[]): ChangeSet { const normalized = proposals.map((proposal) => ({ ...proposal, id: stableId(`${proposal.operation}:${proposal.target}:${proposal.reason}`) })); return { id: stableId(`${title}:${normalized.map((item) => item.id).join(",")}`), title, proposals: normalized, createdAt: new Date().toISOString(), status: "draft" }; }
export function assessChangeRisk(proposals: readonly (ChangeProposal | ChangeProposalInput)[]): RiskLevel { if (proposals.some((proposal) => proposal.risk === "high")) return "high"; if (proposals.some((proposal) => proposal.risk === "medium")) return "medium"; return "low"; }
