import type { EvaluationPlan, KnownOrUnknown } from './evaluation';

export const CALIBRATION_TASK_IDS = ['H01-config-precedence', 'H02-brownfield-script-merge'] as const;
export const CALIBRATION_TREATMENT_COUNT = 3;
export const CALIBRATION_REPETITIONS_PER_TASK = 3;
export const CALIBRATION_PLANNED_INVOCATIONS = 18;
export const HELD_OUT_CALIBRATION_RUN_ID = 'e13-gate-d0-calibration-v1';
const CALIBRATION_CORPUS_LOCK_SHA256 = 'da1a24586d22f4e3f3399292e869f1ce63c7680cb9fc613f76597922ca30a406';
const CALIBRATION_ATOMIC_CATALOG_SHA256 = 'c4e798e59205c8bcc647204816bc7d1eeddac230c25c06f14c8b2889fbef30c9';
const CALIBRATION_TREATMENT_SHA256 = {
  'full-v0.json': '58b475c19fb38790ff8b673759ed7964293d06b677cb04734688b472eef738dd',
  'copy-once.json': '5b77e5b48dc4b9df3712e9f0239a5a219a3615644c8de317deaadc3eafcbc8dd',
  'modular-core.json': '43b042b5e34a25050caf66b6fd2e87e87192b94f2360b48d9e3042e7b8d27023',
} as const;

export interface CalibrationAnalysisPolicy {
  schemaVersion: 1;
  policyId: string;
  design: {
    power: number;
    balancedRepetitionMultiple: 6;
    minimumBalancedRepetitions: 6;
    primaryAndCumulativeInvocationsPerRepetition: 57;
    ablationInvocationsPerRepetition: null;
    planningCreditsPerInvocation: {
      value: 40;
      classification: 'published-average-range-upper-end-not-cap';
      oneCallOvershootPossible: true;
    };
    varianceFamily: { alpha: number; endpointCount: 6 };
    residualDegreesOfFreedom: 4;
    endpoints: Array<{
      id: 'correctness' | 'proof' | 'inputTokens' | 'wallMilliseconds' | 'toolLoops' | 'consumedPlanCredits';
      purpose: 'non-inferiority' | 'material-benefit' | 'guardrail';
      transform: 'identity' | 'natural-log';
      planningBasis: {
        kind: 'absolute-margin' | 'ratio-bound';
        threshold: number;
        plannedValue: number;
        transformedGap: number;
      };
      familyAlpha: number;
      decisionTaskCountK: 2 | 16;
      precisionHalfWidth: number;
      designDelta: number;
      varianceFloor: number;
      oneSidedAlpha: number;
      varianceTailAlpha: number;
    }>;
  };
  approvedHumanCreditCeiling: number | null;
}

export interface BlindedCalibrationObservation {
  taskId: string;
  blockId: string;
  position: 0 | 1 | 2;
  opaqueTreatment: string;
  outcomes: {
    correctness: KnownOrUnknown<number>;
    proof: KnownOrUnknown<number>;
  };
  telemetry: {
    inputTokens: KnownOrUnknown<number>;
    cachedInputTokens: KnownOrUnknown<number>;
    outputTokens: KnownOrUnknown<number>;
    wallMilliseconds: KnownOrUnknown<number>;
    toolLoops: KnownOrUnknown<number>;
    consumedPlanCredits: KnownOrUnknown<number>;
    costUsd: KnownOrUnknown<number>;
  };
}

export interface BlindedSampleSizeReport {
  schemaVersion: 1;
  policyId: string;
  blindState: 'group-identities-withheld';
  observationCount: number;
  groupCount: number;
  residualModel: 'task-specific-latin-square-additive';
  pooledDegreesOfFreedom: 4;
  endpointRequirements: Array<{
    endpoint: string;
    purpose: 'non-inferiority' | 'material-benefit' | 'guardrail';
    decisionTaskCountK: 2 | 16;
    planningBasis: CalibrationAnalysisPolicy['design']['endpoints'][number]['planningBasis'];
    familyAlpha: number;
    transformed: boolean;
    residualVariance: number;
    varianceFloor: number;
    upperVariance: number;
    precisionRequiredRepetitions: number;
    powerRequiredRepetitions: number;
    endpointRequiredRepetitions: number;
  }>;
  balancedRequiredRepetitions: number | null;
  requiredDecisionInvocations: number | null;
  projectedPlanningCredits: number | null;
  creditProjectionBasis: 'published-average-range-upper-end-not-cap';
  oneCallCreditOvershootPossible: true;
  ablationBudgetStatus: 'requires-separate-gate-d-budget-or-approved-e13-amendment';
  approvedHumanCreditCeiling: KnownOrUnknown<number>;
  status: 'selected' | 'evidence-design-blocker';
  selectedBalancedRepetitions: number | null;
  blocker: string | null;
  prohibitedFieldsAbsent: true;
}

export function assertHeldOutCalibrationPlan(plan: EvaluationPlan): void {
  if (plan.runId !== HELD_OUT_CALIBRATION_RUN_ID) {
    throw new Error('held-out calibration run ID differs from the frozen packet');
  }
  if (plan.agent.kind !== 'codex' || plan.agent.scope !== 'calibration') {
    throw new Error('held-out calibration requires a Codex calibration-scope plan');
  }
  if (plan.runner.commit !== '2013dd55bac4c4bbc5bd9eff950eeb6f24d999ef') {
    throw new Error('held-out calibration runner commit must equal the US-029 commit');
  }
  if (
    plan.corpus.lockSha256 !== CALIBRATION_CORPUS_LOCK_SHA256 ||
    plan.corpus.atomicCatalogSha256 !== CALIBRATION_ATOMIC_CATALOG_SHA256
  ) {
    throw new Error('held-out calibration corpus identity differs from the frozen packet');
  }
  if (plan.cumulativeJourneys.length !== 0 || plan.cells.length !== CALIBRATION_PLANNED_INVOCATIONS) {
    throw new Error('held-out calibration must contain exactly 18 atomic calls and no cumulative journey');
  }
  const positions = plan.cells.map((cell) => cell.order.position);
  if (positions.some((position, index) => position !== index)) {
    throw new Error('held-out calibration calls must be sequential positions 0 through 17');
  }
  const treatmentShas = [...new Set(plan.cells.map((cell) => cell.treatment.sha256))].sort();
  if (treatmentShas.length !== CALIBRATION_TREATMENT_COUNT) {
    throw new Error('held-out calibration must use exactly three treatment identities');
  }
  const blocks = new Map<string, typeof plan.cells>();
  for (const cell of plan.cells) {
    if (!CALIBRATION_TASK_IDS.includes(cell.taskId as typeof CALIBRATION_TASK_IDS[number])) {
      throw new Error(`decision-corpus task is forbidden in calibration: ${cell.taskId}`);
    }
    if (cell.mode !== 'atomic' || cell.dependencies.length !== 0) {
      throw new Error(`calibration cell must be independent and atomic: ${cell.id}`);
    }
    if (cell.order.repetition < 0 || cell.order.repetition >= CALIBRATION_REPETITIONS_PER_TASK) {
      throw new Error(`calibration repetition is out of range: ${cell.id}`);
    }
    const key = `${cell.taskId}:${cell.order.repetition}`;
    blocks.set(key, [...(blocks.get(key) ?? []), cell]);
  }
  if (blocks.size !== 6) throw new Error('held-out calibration must contain six task-repetition blocks');
  const permutations = new Set<string>();
  for (const [key, cells] of blocks) {
    if (cells.length !== 3) throw new Error(`calibration block must contain three calls: ${key}`);
    const ordered = [...cells].sort((left, right) => left.order.position - right.order.position);
    const shas = ordered.map((cell) => cell.treatment.sha256);
    if (new Set(shas).size !== 3 || shas.some((sha) => !treatmentShas.includes(sha))) {
      throw new Error(`calibration block does not contain each treatment once: ${key}`);
    }
    permutations.add(shas.join(':'));
  }
  if (permutations.size !== 6) {
    throw new Error('held-out calibration must use all six treatment-order permutations exactly once');
  }
  const exact = [
    ['H01-config-precedence', 0, ['full-v0.json', 'copy-once.json', 'modular-core.json']],
    ['H02-brownfield-script-merge', 0, ['full-v0.json', 'modular-core.json', 'copy-once.json']],
    ['H01-config-precedence', 1, ['copy-once.json', 'modular-core.json', 'full-v0.json']],
    ['H02-brownfield-script-merge', 1, ['modular-core.json', 'copy-once.json', 'full-v0.json']],
    ['H01-config-precedence', 2, ['modular-core.json', 'full-v0.json', 'copy-once.json']],
    ['H02-brownfield-script-merge', 2, ['copy-once.json', 'full-v0.json', 'modular-core.json']],
  ] as const;
  for (let block = 0; block < exact.length; block += 1) {
    const [taskId, repetition, manifests] = exact[block];
    const actual = plan.cells.slice(block * 3, block * 3 + 3);
    if (actual.some((cell, localPosition) =>
      cell.taskId !== taskId || cell.order.repetition !== repetition ||
      !cell.treatment.path.endsWith(`/${manifests[localPosition]}`) ||
      cell.treatment.sha256 !== CALIBRATION_TREATMENT_SHA256[manifests[localPosition]])) {
      throw new Error(`held-out calibration schedule differs at contiguous block ${block}`);
    }
  }
  for (const taskId of CALIBRATION_TASK_IDS) {
    for (let repetition = 0; repetition < CALIBRATION_REPETITIONS_PER_TASK; repetition += 1) {
      if (!blocks.has(`${taskId}:${repetition}`)) {
        throw new Error(`missing calibration block ${taskId}:${repetition}`);
      }
    }
  }
}

export function isHeldOutCalibrationPlan(plan: EvaluationPlan): boolean {
  return plan.runId === HELD_OUT_CALIBRATION_RUN_ID;
}
