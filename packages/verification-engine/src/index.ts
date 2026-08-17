export type TestKind = 'static' | 'unit' | 'integration' | 'playtest' | 'multiplayer' | 'performance' | 'security';
export type TestStatus = 'pending' | 'running' | 'passed' | 'failed' | 'blocked' | 'skipped';
export type FailureKind = 'build' | 'runtime' | 'logic' | 'integration' | 'visual' | 'security' | 'performance' | 'environment';

export interface AcceptanceCriterion { id: string; description: string; required: boolean }
export interface TestCase { id: string; name: string; kind: TestKind; steps: string[]; expected: string[]; priority: 'low' | 'medium' | 'high' | 'critical' }
export interface TestResult { testId: string; status: TestStatus; startedAt?: string; finishedAt?: string; evidence: Evidence[]; failure?: Failure }
export interface Evidence { type: 'console' | 'runtime' | 'screenshot' | 'metric' | 'assertion' | 'tool'; summary: string; value?: string | number; source?: string }
export interface Failure { kind: FailureKind; message: string; details?: string; recoverable: boolean }
export interface VerificationRun { id: string; startedAt: string; tests: TestCase[]; results: TestResult[]; criteria: AcceptanceCriterion[] }

export function createVerificationRun(input: Omit<VerificationRun, 'results'>): VerificationRun { return { ...input, results: [] }; }

export function recordResult(run: VerificationRun, result: TestResult): VerificationRun {
  const results = run.results.filter(r => r.testId !== result.testId);
  results.push(result);
  return { ...run, results };
}

export function evaluateRun(run: VerificationRun): { passed: boolean; blocked: boolean; missingCriteria: string[]; failures: Failure[] } {
  const failures = run.results.flatMap(r => r.failure ? [r.failure] : []);
  const missingCriteria = run.criteria.filter(c => c.required && !run.results.some(r => r.status === 'passed' && r.evidence.some(e => e.type === 'assertion' && e.summary.includes(c.id)))).map(c => c.id);
  const blocked = run.results.some(r => r.status === 'blocked');
  const passed = !blocked && failures.length === 0 && missingCriteria.length === 0 && run.tests.length > 0 && run.tests.every(t => run.results.find(r => r.testId === t.id)?.status === 'passed');
  return { passed, blocked, missingCriteria, failures };
}

export function classifyFailure(message: string): FailureKind {
  const m = message.toLowerCase();
  if (/compile|type.?error|build/.test(m)) return 'build';
  if (/security|permission|unauthorized|exploit/.test(m)) return 'security';
  if (/performance|fps|memory|timeout/.test(m)) return 'performance';
  if (/screenshot|visual|layout/.test(m)) return 'visual';
  if (/network|integration|remote/.test(m)) return 'integration';
  if (/assert|expected|logic/.test(m)) return 'logic';
  if (/runtime|exception|error/.test(m)) return 'runtime';
  return 'environment';
}

export function repairPlan(failure: Failure): { action: 'repair' | 'rerun' | 'escalate'; reason: string } {
  if (!failure.recoverable) return { action: 'escalate', reason: 'Failure is not marked recoverable; human review is required.' };
  if (failure.kind === 'environment') return { action: 'rerun', reason: 'Environment failures may be transient and should be retried before code changes.' };
  return { action: 'repair', reason: `Repair the ${failure.kind} failure, then rerun the affected test and regression checks.` };
}
