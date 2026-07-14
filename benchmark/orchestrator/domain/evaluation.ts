import path from 'node:path';

export type EvaluationMode = 'atomic' | 'cumulative';
export type CellStatus = 'passed' | 'failed' | 'invalid' | 'blocked_dependency';

export interface ContentIdentity {
  path: string;
  sha256: string;
}

export interface FixtureIdentity {
  taskId: string;
  fixtureSha256: string;
  startCommit: string;
  materializedTreeSha256: string;
}

export interface TreatmentIdentity extends ContentIdentity {
  sourceRoot: string;
  profile: string;
  platform: string;
  artifactCache?: string;
}

export interface EvaluationCellSpec {
  id: string;
  taskId: string;
  mode: EvaluationMode;
  dependencies: string[];
  treatment: TreatmentIdentity;
  timeoutSeconds: number;
  order: {
    repetition: number;
    position: number;
  };
}

export interface CumulativeJourneySpec {
  id: string;
  journeyId: string;
  treatment: TreatmentIdentity;
  timeoutSeconds: number;
  order: {
    repetition: number;
    position: number;
  };
}

export type EvaluationAgentPlan =
  | {
      kind: 'fake';
      command: string;
      args: string[];
    }
  | {
      kind: 'codex';
      executable: ContentIdentity & { version: string };
      scope: 'calibration' | 'decision';
      authorization: ContentIdentity;
      protocol: ContentIdentity;
      pricingPolicy: ContentIdentity;
      toolPolicy: ContentIdentity;
    };

export interface EvaluationPlan {
  version: 1;
  runId: string;
  runner: {
    repository: string;
    commit: string;
  };
  agent: EvaluationAgentPlan;
  model: {
    declared: string;
    provider: string;
    runtime: string;
    resolved: KnownOrUnknown<string>;
  };
  reasoningEffort: string;
  sandbox: string;
  toolCatalogSha256: string;
  corpus: {
    root: string;
    lockSha256: string;
    atomicCatalogSha256: string;
    cumulativeCatalogSha256?: string;
  };
  cells: EvaluationCellSpec[];
  cumulativeJourneys: CumulativeJourneySpec[];
}

export type KnownOrUnknown<T> =
  | { status: 'known'; value: T }
  | { status: 'unknown'; reason: string };

export interface ObservedRubricResult {
  id: string;
  pass: boolean;
  critical: boolean;
  error: string | null;
  evidence: unknown;
}

export interface EffectiveRubricResult extends ObservedRubricResult {
  effectivePass: boolean;
  blockedByProcess: boolean;
}

export interface TreatmentApplicationReceipt {
  schemaVersion: 1;
  operation: 'apply';
  candidateId: string;
  activationProfile: string;
  taskClasses: string[];
  platform: string;
  manifestSha256: string;
  applicationPolicySha256: string;
  materializationReceiptSha256: string;
  originalTreeSha256: string;
  stagedTreeSha256: string;
  resultingTreeSha256: string;
  visibleInstructionProof: {
    allDeclaredInstructionsVisible: boolean;
    paths: unknown[];
  };
  files: Array<{
    path: string;
    action: 'create-if-absent' | 'preserve-existing' | 'append-marked-block' | 'merge-lines';
    originalSha256: string | null;
    stagedSha256: string;
    resultSha256: string;
  }>;
}

export interface RawCellRecord {
  version: 1;
  runId: string;
  cellId: string;
  mode: EvaluationMode;
  dependencies: string[];
  status: CellStatus;
  invalidReason?: string;
  blockedBy?: string[];
  identities: {
    runner: EvaluationPlan['runner'];
    fixture: FixtureIdentity;
    prompt: { sha256: string };
    rubric: { sha256: string; runnerSha256: string; checkIds: string[] };
    corpus: EvaluationPlan['corpus'];
    treatment: TreatmentIdentity & {
      candidateId?: string;
      stagedTreeSha256?: string;
      appliedTreeSha256?: string;
    };
    model: EvaluationPlan['model'];
    sandbox: string;
    toolCatalogSha256: string;
    order: EvaluationCellSpec['order'];
  };
  process: {
    exitCode: number | null;
    signal: NodeJS.Signals | null;
    timedOut: boolean;
    stdoutSha256: string;
    stderrSha256: string;
  };
  evidence?: {
    stdout: ContentIdentity;
    stderr: ContentIdentity;
    fixtureReceipt: ContentIdentity;
    rubricStartReceipt: ContentIdentity;
    metricsReceipt: ContentIdentity;
    workspaceDiff: ContentIdentity;
    scoreReceipt: ContentIdentity;
    treatmentApplicationReceipt: ContentIdentity;
  };
  rubric: {
    scoreReceiptSha256?: string;
    expectedCheckIds: string[];
    observed: ObservedRubricResult[];
    effective: EffectiveRubricResult[];
  };
  metrics: {
    wallMilliseconds: KnownOrUnknown<number>;
    inputTokens: KnownOrUnknown<number>;
    cachedInputTokens: KnownOrUnknown<number>;
    outputTokens: KnownOrUnknown<number>;
    toolLoops: KnownOrUnknown<number>;
    consumedPlanCredits: KnownOrUnknown<number>;
    costUsd: KnownOrUnknown<number>;
  };
  workspace: {
    beforeSha256?: string;
    afterSha256?: string;
    diffSha256?: string;
    disposed: boolean;
  };
  treatmentApplication?: TreatmentApplicationReceipt;
  diagnostics: {
    v0Adherence: KnownOrUnknown<{ pass: number; total: number }>;
  };
}

export interface EvaluationAggregate {
  version: 1;
  runId: string;
  expectedCellIds: string[];
  sourceCells: Array<{ cellId: string; sha256: string }>;
  cells: Array<{
    cellId: string;
    status: CellStatus;
    primaryPass: number;
    primaryTotal: number;
  }>;
  primaryPass: number;
  primaryTotal: number;
  unknownMetrics: number;
}

export interface CumulativeStepRecord {
  stepId: string;
  dependencies: string[];
  status: CellStatus;
  blockedBy?: string[];
  process: {
    exitCode: number | null;
    signal: NodeJS.Signals | null;
    timedOut: boolean;
    stdoutSha256: string;
    stderrSha256: string;
  };
  evidence: {
    stdoutJsonl?: ContentIdentity;
    stderr?: ContentIdentity;
    metricsReceipt?: ContentIdentity;
    scoreReceipt?: ContentIdentity;
  };
  rubric: {
    expectedCheckIds: string[];
    observed: ObservedRubricResult[];
    effective: EffectiveRubricResult[];
  };
  metrics: RawCellRecord['metrics'] & {
    cachedInputTokens: KnownOrUnknown<number>;
    toolLoops: KnownOrUnknown<number>;
    consumedPlanCredits: KnownOrUnknown<number>;
  };
  workspace: {
    beforeSha256?: string;
    afterSha256?: string;
  };
}

export interface CumulativeJourneyRecord {
  version: 1;
  runId: string;
  journeyRunId: string;
  catalogJourneyId: string;
  excludedFromAtomicScores: true;
  identities: {
    runner: EvaluationPlan['runner'];
    fixture: { fixtureSha256: string; startCommit: string };
    treatment: TreatmentIdentity & {
      candidateId: string;
      stagedTreeSha256: string;
      appliedTreeSha256: string;
      appliedWorkspaceSha256: string;
    };
    agent: EvaluationPlan['agent'];
    model: EvaluationPlan['model'];
    reasoningEffort: string;
    sandbox: string;
    toolCatalogSha256: string;
    order: CumulativeJourneySpec['order'];
  };
  treatmentApplication: TreatmentApplicationReceipt;
  treatmentApplicationCount: 1;
  steps: CumulativeStepRecord[];
  workspace: { disposed: boolean };
}

export function validateEvaluationPlan(plan: EvaluationPlan): void {
  if (plan.cells.length === 0 && plan.cumulativeJourneys.length === 0) {
    throw new Error('evaluation plan must contain at least one cell or cumulative journey');
  }
  const seen = new Set<string>();
  const positions = new Set<number>();
  for (const cell of plan.cells) {
    if (!/^[A-Za-z0-9._-]+$/.test(cell.id)) throw new Error(`unsafe evaluation cell id: ${cell.id}`);
    if (seen.has(cell.id)) throw new Error(`duplicate evaluation cell id: ${cell.id}`);
    if (positions.has(cell.order.position)) {
      throw new Error(`duplicate evaluation order position: ${cell.order.position}`);
    }
    if (cell.mode === 'atomic' && cell.dependencies.length > 0) {
      throw new Error(`atomic cell ${cell.id} cannot have dependencies`);
    }
    if (new Set(cell.dependencies).size !== cell.dependencies.length) {
      throw new Error(`cell ${cell.id} has duplicate dependencies`);
    }
    for (const dependency of cell.dependencies) {
      if (!seen.has(dependency)) {
        throw new Error(`cell ${cell.id} depends on ${dependency} before it appears`);
      }
    }
    if (!cell.taskId) throw new Error(`cell ${cell.id} has no task id`);
    seen.add(cell.id);
    positions.add(cell.order.position);
  }
  const journeyIds = new Set<string>();
  for (const journey of plan.cumulativeJourneys) {
    if (!/^[A-Za-z0-9._-]+$/.test(journey.id)) throw new Error(`unsafe cumulative journey id: ${journey.id}`);
    if (journeyIds.has(journey.id)) throw new Error(`duplicate cumulative journey id: ${journey.id}`);
    if (seen.has(journey.id)) throw new Error(`evaluation id is reused across atomic and cumulative plans: ${journey.id}`);
    if (positions.has(journey.order.position)) {
      throw new Error(`duplicate evaluation order position: ${journey.order.position}`);
    }
    if (!journey.journeyId) throw new Error(`cumulative journey ${journey.id} has no catalog journey id`);
    journeyIds.add(journey.id);
    positions.add(journey.order.position);
  }
  if (plan.agent.kind === 'codex') {
    if (plan.sandbox !== 'workspace-write') {
      throw new Error('Codex evaluation requires the workspace-write sandbox');
    }
    if (!plan.reasoningEffort) throw new Error('Codex evaluation requires an explicit reasoning effort');
    if (!path.isAbsolute(plan.corpus.root)) throw new Error('Codex corpus root must be absolute');
    for (const item of [...plan.cells, ...plan.cumulativeJourneys]) {
      if (!path.isAbsolute(item.treatment.path) || !path.isAbsolute(item.treatment.sourceRoot)) {
        throw new Error(`Codex treatment paths must be absolute: ${item.id}`);
      }
    }
  }
}

export function effectiveRubricResults(
  expectedCheckIds: string[],
  observed: ObservedRubricResult[],
  processExitCode: number,
): EffectiveRubricResult[] {
  const byId = new Map(observed.map((result) => [result.id, result]));
  if (byId.size !== observed.length) throw new Error('rubric returned duplicate check ids');
  for (const result of observed) {
    if (!expectedCheckIds.includes(result.id)) {
      throw new Error(`rubric returned unexpected check id: ${result.id}`);
    }
  }
  return expectedCheckIds.map((id) => {
    const result = byId.get(id) ?? {
      id,
      pass: false,
      critical: false,
      error: 'rubric result missing',
      evidence: null,
    };
    return {
      ...result,
      effectivePass: processExitCode === 0 && result.pass,
      blockedByProcess: processExitCode !== 0,
    };
  });
}
