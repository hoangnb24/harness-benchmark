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

export interface EvaluationPlan {
  version: 1;
  runId: string;
  runner: {
    repository: string;
    commit: string;
  };
  agent: {
    kind: 'fake';
    command: string;
    args: string[];
  };
  model: {
    declared: string;
    provider: string;
    runtime: string;
    resolved: KnownOrUnknown<string>;
  };
  sandbox: string;
  toolCatalogSha256: string;
  corpus: {
    root: string;
    lockSha256: string;
    atomicCatalogSha256: string;
  };
  cells: EvaluationCellSpec[];
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
    outputTokens: KnownOrUnknown<number>;
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

export function validateEvaluationPlan(plan: EvaluationPlan): void {
  if (plan.cells.length === 0) throw new Error('evaluation plan must contain at least one cell');
  const seen = new Set<string>();
  const positions = new Set<number>();
  for (const cell of plan.cells) {
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
