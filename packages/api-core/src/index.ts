import type { CreatorRequest } from '@lua-x/shared';
import { orchestrate, type OrchestrationResult } from '@lua-x/orchestrator';
import {
  createChangeSet as createExecutionChangeSet,
  type CodeChangeSet,
  type CodeOperation,
} from '@lua-x/execution-engine';
import {
  createVerificationRun,
  type AcceptanceCriterion,
  type TestCase,
  type VerificationRun,
} from '@lua-x/verification-engine';
import {
  createSession,
  setPlan,
  type BuildPlan,
  type BuildSession,
  type WorkKind,
} from '@lua-x/autonomous-engine';
import {
  createWorkspace,
  startTask,
  routeTask,
  type Surface,
  type UnifiedTask,
  type WorkspaceSession,
} from '@lua-x/fusion-core';
import { createProject, recordAudit, type ProjectRecord } from '@lua-x/cloud-core';
import { health, type HealthState } from '@lua-x/hardening-core';
import { createNoopTransport, RobloxMcpBridge } from '@lua-x/roblox-mcp-bridge';
import { createAnimationClip, validateAnimationClip } from '@lua-x/animation-engine';
import { createScreen, validateScreen, type UIComponent } from '@lua-x/ui-engine';
import { validateWorld, type WorldSpec } from '@lua-x/world-engine';
import type { NvidiaChatResponse, NvidiaClientPool, ChatMessage } from '@lua-x/nvidia-provider';

export type ChangeOperation =
  | 'create_script'
  | 'update_script'
  | 'create_instance'
  | 'update_instance'
  | 'delete_instance'
  | 'create_animation'
  | 'create_sound'
  | 'create_vfx'
  | 'create_ui'
  | 'note';

export type ChangeRisk = 'low' | 'medium' | 'high' | 'critical';

export interface ChangeProposal {
  operation: ChangeOperation;
  target: string;
  reason: string;
  risk: ChangeRisk;
  content?: string;
}

export interface AIPlan {
  summary: string;
  assumptions: string[];
  changes: ChangeProposal[];
  acceptanceCriteria: string[];
  verification: string[];
  risks: string[];
}

export interface AIRequest extends CreatorRequest {
  readonly context?: {
    readonly relevantFiles?: readonly string[];
    readonly relevantInstances?: readonly string[];
    readonly architecture?: string;
    readonly constraints?: readonly string[];
    readonly workspaceTree?: string;
    readonly scripts?: readonly string[];
    readonly selection?: readonly string[];
    readonly place?: {
      readonly name?: string;
      readonly placeId?: string;
      readonly services?: readonly string[];
    };
  };
}

export interface GenerationPipeline {
  readonly orchestration: OrchestrationResult;
  readonly executionChangeSet: CodeChangeSet;
  readonly verificationRun: VerificationRun;
  readonly buildSession: BuildSession;
  readonly workspace: WorkspaceSession;
  readonly project: ProjectRecord;
  readonly studio: { connected: false; bridge: RobloxMcpBridge };
  readonly capabilityChecks: {
    animation: { valid: boolean; issues: readonly string[] };
    ui: { valid: boolean; issues: readonly string[] };
    world: { valid: boolean; issues: readonly string[] };
  };
  readonly health: HealthState;
  readonly mode: CreatorRequest['mode'] extends undefined ? string : string;
  readonly activeSurfaces: readonly Surface[];
}

export interface GenerationResult {
  readonly provider: 'nvidia';
  readonly model?: string;
  readonly requestId?: string;
  readonly plan: AIPlan;
  readonly pipeline: GenerationPipeline;
}

export interface ChatProvider {
  chat(messages: readonly ChatMessage[]): Promise<NvidiaChatResponse>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function normalizePlan(text: string): string {
  return text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
}

function extractJson(text: string): unknown {
  const cleaned = normalizePlan(text);
  try {
    return JSON.parse(cleaned);
  } catch {
    // fall through to the balanced-brace scan
  }
  for (let i = 0; i < cleaned.length; i += 1) {
    if (cleaned[i] !== '{') continue;
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let j = i; j < cleaned.length; j += 1) {
      const ch = cleaned[j];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === '\\') {
        escaped = true;
        continue;
      }
      if (ch === '"') {
        inString = !inString;
        continue;
      }
      if (inString) continue;
      if (ch === '{') depth += 1;
      else if (ch === '}') {
        depth -= 1;
        if (depth === 0) {
          try {
            return JSON.parse(cleaned.slice(i, j + 1));
          } catch {
            break;
          }
        }
      }
    }
  }
  return undefined;
}

export function parseAIPlan(text: string): AIPlan {
  const parsed = extractJson(text);
  if (parsed === undefined) throw new Error('No valid JSON object found in the AI response.');
  if (!isRecord(parsed)) throw new Error('AI plan must be an object.');

  const { summary, assumptions, changes, acceptanceCriteria, verification, risks } = parsed;
  if (typeof summary !== 'string' || !summary.trim()) throw new Error('AI plan summary is missing.');
  if (!Array.isArray(assumptions) || !assumptions.every((value) => typeof value === 'string')) {
    throw new Error('AI plan assumptions are invalid.');
  }
  if (!Array.isArray(changes)) throw new Error('AI plan changes are invalid.');
  if (!Array.isArray(acceptanceCriteria) || !acceptanceCriteria.every((value) => typeof value === 'string')) {
    throw new Error('AI plan acceptance criteria are invalid.');
  }
  if (!Array.isArray(verification) || !verification.every((value) => typeof value === 'string')) {
    throw new Error('AI plan verification is invalid.');
  }
  if (!Array.isArray(risks) || !risks.every((value) => typeof value === 'string')) {
    throw new Error('AI plan risks are invalid.');
  }

  const operations = new Set<ChangeOperation>([
    'create_script',
    'update_script',
    'create_instance',
    'update_instance',
    'delete_instance',
    'create_animation',
    'create_sound',
    'create_vfx',
    'create_ui',
    'note',
  ]);
  const riskLevels = new Set<ChangeRisk>(['low', 'medium', 'high', 'critical']);
  const validated: ChangeProposal[] = [];

  for (const item of changes) {
    if (!isRecord(item)) throw new Error('AI plan contains an invalid change proposal.');
    if (typeof item.operation !== 'string' || !operations.has(item.operation as ChangeOperation)) {
      throw new Error('AI plan contains an unsupported operation.');
    }
    if (typeof item.target !== 'string' || !item.target.trim()) throw new Error('Change target is required.');
    if (typeof item.reason !== 'string' || !item.reason.trim()) throw new Error('Change reason is required.');
    if (typeof item.risk !== 'string' || !riskLevels.has(item.risk as ChangeRisk)) throw new Error('Change risk is invalid.');
    if (item.content !== undefined && typeof item.content !== 'string') throw new Error('Change content must be a string.');

    validated.push({
      operation: item.operation as ChangeOperation,
      target: item.target,
      reason: item.reason,
      risk: item.risk as ChangeRisk,
      ...(typeof item.content === 'string' ? { content: item.content } : {}),
    });
  }

  return {
    summary,
    assumptions,
    changes: validated,
    acceptanceCriteria,
    verification,
    risks,
  };
}

function workKind(agent: string): WorkKind {
  if (agent === 'animation' || agent === 'ui' || agent === 'world' || agent === 'security' || agent === 'performance' || agent === 'verification' || agent === 'code') {
    return agent === 'code' ? 'code' : agent;
  }
  if (agent === 'luau') return 'code';
  return 'architecture';
}

function surfacesForAgents(agents: readonly string[]): Surface[] {
  const surfaces = new Set<Surface>();
  for (const agent of agents) {
    if (agent === 'luau') surfaces.add('code');
    else if (agent === 'animation') surfaces.add('animation');
    else if (agent === 'ui') surfaces.add('ui');
    else if (agent === 'world') surfaces.add('world');
    else if (agent === 'playtest' || agent === 'verification') surfaces.add('verification');
    else surfaces.add('project');
  }
  return [...surfaces];
}

function scriptOperations(plan: AIPlan): CodeOperation[] {
  return plan.changes.flatMap((change, index) => {
    if (change.operation !== 'create_script' && change.operation !== 'update_script') return [];
    return [{
      id: `aiop-${String(index + 1).padStart(3, '0')}`,
      kind: change.operation === 'create_script' ? 'create-script' : 'replace-script',
      target: change.target,
      datamodelType: 'Edit' as const,
      content: change.content,
      reason: change.reason,
      risk: change.risk,
    } satisfies CodeOperation];
  });
}

function verificationCases(plan: AIPlan): TestCase[] {
  return plan.verification.map((criterion, index) => ({
    id: `verify-${String(index + 1).padStart(2, '0')}`,
    name: criterion,
    kind: 'static',
    steps: [criterion],
    expected: [criterion],
    priority: plan.risks.length > 0 ? 'high' : 'medium',
  }));
}

function buildAutonomousPlan(orchestration: OrchestrationResult): BuildPlan {
  return {
    id: `autoplan-${orchestration.plan.changeSet.id}`,
    goalId: `goal-${orchestration.plan.changeSet.id}`,
    generatedAt: new Date().toISOString(),
    work: orchestration.plan.tasks.map((task) => ({
      id: task.id,
      kind: workKind(task.agent),
      title: task.title,
      description: task.description,
      dependsOn: [...task.dependsOn],
      risk: task.agent === 'security' ? 'high' : task.agent === 'performance' ? 'medium' : 'low',
      acceptanceCriteria: [...task.acceptanceCriteria],
    })),
  };
}

function capabilityChecks(orchestration: OrchestrationResult, now: Date) {
  const agents = new Set(orchestration.brief.specialistAgents);

  const animation = createAnimationClip({
    name: 'LUA-X Integration Check',
    action: orchestration.brief.objective.userIntent,
    rig: 'unknown',
  }, now);
  const animationResult = validateAnimationClip(animation);

  const root: UIComponent = { id: 'root', kind: 'frame', name: 'Root' };
  const screen = createScreen({
    id: 'lua-x-integration',
    name: 'LUA-X Integration Check',
    rootId: root.id,
    components: [root],
    theme: { tokens: {} },
    responsive: { rules: [] },
  });
  const uiIssues = validateScreen(screen);

  const world: WorldSpec = {
    id: 'lua-x-integration',
    name: 'LUA-X Integration Check',
    assets: [],
    zones: [],
    landmarks: [],
    paths: [],
    budget: { notes: [] },
    streaming: { enabled: false, regions: [] },
    design: { paletteTokens: {}, mood: 'neutral', density: 'balanced' },
  };
  const worldIssues = validateWorld(world);

  return {
    animation: {
      valid: !agents.has('animation') || animationResult.valid,
      issues: animationResult.issues.map((issue) => issue.message),
    },
    ui: {
      valid: !agents.has('ui') || uiIssues.every((issue) => issue.severity !== 'error'),
      issues: uiIssues.map((issue) => issue.message),
    },
    world: {
      valid: !agents.has('world') || worldIssues.every((issue) => issue.severity !== 'error'),
      issues: worldIssues.map((issue) => issue.message),
    },
  };
}

export function preparePipeline(request: AIRequest, plan: AIPlan, orchestration: OrchestrationResult, now = new Date()): GenerationPipeline {
  const projectId = request.projectId?.trim() || 'local';
  const activeSurfaces = surfacesForAgents(orchestration.brief.specialistAgents);
  const unifiedTask: UnifiedTask = {
    id: `task-${orchestration.plan.changeSet.id}`,
    prompt: request.prompt,
    surfaces: activeSurfaces.length ? activeSurfaces : ['project'],
    acceptanceCriteria: [...plan.acceptanceCriteria],
    requiresStudio: true,
  };

  const workspace = startTask(createWorkspace(projectId), unifiedTask);
  const project = createProject(projectId, `LUA-X ${projectId}`, 'local-user');
  const auditEvent = recordAudit(projectId, 'local-user', 'ai_plan_created', orchestration.plan.changeSet.id);
  void auditEvent;

  const executionChangeSet = createExecutionChangeSet(
    orchestration.brief,
    scriptOperations(plan),
  );

  const criteria: AcceptanceCriterion[] = plan.acceptanceCriteria.map((description, index) => ({
    id: `criterion-${String(index + 1).padStart(2, '0')}`,
    description,
    required: true,
  }));
  const verificationRun = createVerificationRun({
    id: `verification-${orchestration.plan.changeSet.id}`,
    startedAt: now.toISOString(),
    tests: verificationCases(plan),
    criteria,
  });

  const goal = {
    id: `goal-${orchestration.plan.changeSet.id}`,
    description: request.prompt,
    priority: plan.risks.length ? 'high' as const : 'medium' as const,
    acceptanceCriteria: [...plan.acceptanceCriteria],
  };
  const buildSession = setPlan(
    createSession(goal),
    buildAutonomousPlan(orchestration),
  );

  const bridge = new RobloxMcpBridge({ transport: createNoopTransport(), requireConfirmation: true });
  const pipelineHealth = health({
    orchestrator: 'up',
    execution: 'up',
    verification: 'up',
    autonomous: 'up',
    fusion: 'up',
    cloud: 'up',
    hardening: 'up',
    studio: 'down',
  });

  return {
    orchestration,
    executionChangeSet,
    verificationRun,
    buildSession,
    workspace,
    project,
    studio: { connected: false, bridge },
    capabilityChecks: capabilityChecks(orchestration, now),
    health: pipelineHealth,
    mode: request.mode ?? 'build',
    activeSurfaces: routeTask(unifiedTask),
  };
}

export async function generateAIPlan(request: AIRequest, provider: ChatProvider): Promise<GenerationResult> {
  if (!request.prompt.trim()) throw new Error('Creator prompt cannot be empty.');

  const orchestration = orchestrate(request);
  const compiled = orchestration.compiledPrompt;
  const userMessage = [
    compiled.context,
    compiled.task,
    `Acceptance criteria:\n${compiled.acceptance}`,
    `Verification requirements:\n${compiled.verification}`,
    'Return ONLY valid JSON with this exact top-level shape: summary, assumptions, changes, acceptanceCriteria, verification, risks.',
    'Never claim that Studio execution, tests, playtests, or publishing succeeded unless evidence is present.',
  ].join('\n\n');

  const result = await provider.chat([
    { role: 'system', content: compiled.system },
    { role: 'user', content: userMessage },
  ]);
  const plan = parseAIPlan(result.content);

  return {
    provider: 'nvidia',
    model: result.model,
    requestId: result.requestId,
    plan,
    pipeline: preparePipeline(request, plan, orchestration),
  };
}

export { orchestrate } from '@lua-x/orchestrator';
