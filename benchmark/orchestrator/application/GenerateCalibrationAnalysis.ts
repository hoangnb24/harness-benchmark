import {
  CALIBRATION_TASK_IDS,
  type BlindedCalibrationObservation,
  type BlindedSampleSizeReport,
  type CalibrationAnalysisPolicy,
} from '../domain/calibration';

const PROHIBITED_REPORT_KEYS = ['treatment', 'label', 'mean', 'rank', 'effect'];
export class GenerateCalibrationAnalysis {
  build(
    policy: CalibrationAnalysisPolicy,
    observations: BlindedCalibrationObservation[],
  ): BlindedSampleSizeReport {
    validatePolicy(policy);
    validateObservations(observations);
    const unknownEndpoints = new Set<string>();
    const endpointRequirements = policy.design.endpoints.map((endpoint) => {
      const values = observations.map((observation) => endpointValue(observation, endpoint.id));
      if (values.some((value) => value.status === 'unknown')) unknownEndpoints.add(endpoint.id);
      const numeric = values.map((value) => value.status === 'known' ? value.value : Number.NaN);
      const transformed = numeric.map((value) => endpoint.transform === 'natural-log'
        ? Math.log(endpoint.id === 'toolLoops' ? Math.max(1, value) : value)
        : value);
      const residualVariance = numeric.some((value) => !Number.isFinite(value))
        ? Number.NaN
        : latinSquareResidualVariance(observations, transformed);
      const quantile = chiSquareLowerDf4(endpoint.varianceTailAlpha);
      const residualSse = residualVariance * policy.design.residualDegreesOfFreedom;
      const upperVariance = Number.isFinite(residualSse)
        ? Math.max(endpoint.varianceFloor, residualSse / quantile)
        : Number.NaN;
      const zPrecision = inverseNormal(1 - endpoint.oneSidedAlpha);
      const zPower = inverseNormal(policy.design.power);
      const precisionRequired = Number.isFinite(upperVariance)
        ? Math.ceil((2 * upperVariance * (zPrecision ** 2)) /
          (endpoint.decisionTaskCountK * (endpoint.precisionHalfWidth ** 2)))
        : 0;
      const powerRequired = Number.isFinite(upperVariance)
        ? Math.ceil((2 * upperVariance * ((zPrecision + zPower) ** 2)) /
          (endpoint.decisionTaskCountK * (endpoint.designDelta ** 2)))
        : 0;
      return {
        endpoint: endpoint.id,
        purpose: endpoint.purpose,
        decisionTaskCountK: endpoint.decisionTaskCountK,
        planningBasis: endpoint.planningBasis,
        familyAlpha: endpoint.familyAlpha,
        transformed: endpoint.transform === 'natural-log',
        residualVariance,
        varianceFloor: endpoint.varianceFloor,
        upperVariance,
        precisionRequiredRepetitions: precisionRequired,
        powerRequiredRepetitions: powerRequired,
        endpointRequiredRepetitions: Math.max(precisionRequired, powerRequired),
      };
    });
    const maximumEndpointRequirement = Math.max(
      policy.design.minimumBalancedRepetitions,
      ...endpointRequirements.map((endpoint) => endpoint.endpointRequiredRepetitions),
    );
    const preliminaryBalanced = roundUp(maximumEndpointRequirement, 6);
    const ceiling = policy.approvedHumanCreditCeiling;
    const blocker = unknownEndpoints.size > 0
      ? `required-sizing-telemetry-unknown:${[...unknownEndpoints].sort().join(',')}`
      : ceiling === null
        ? 'approved-human-credit-ceiling-missing'
        : (preliminaryBalanced * policy.design.primaryAndCumulativeInvocationsPerRepetition *
          policy.design.planningCreditsPerInvocation.value) > ceiling
          ? 'precision-and-power-design-exceeds-approved-credit-ceiling'
          : null;
    const balancedRequired = unknownEndpoints.size > 0 ? null : preliminaryBalanced;
    const requiredDecisionInvocations = balancedRequired === null
      ? null
      : balancedRequired * policy.design.primaryAndCumulativeInvocationsPerRepetition;
    const projectedPlanningCredits = requiredDecisionInvocations === null
      ? null
      : requiredDecisionInvocations * policy.design.planningCreditsPerInvocation.value;
    const report: BlindedSampleSizeReport = {
      schemaVersion: 1,
      policyId: policy.policyId,
      blindState: 'group-identities-withheld',
      observationCount: observations.length,
      groupCount: 3,
      residualModel: 'task-specific-latin-square-additive',
      pooledDegreesOfFreedom: 4,
      endpointRequirements,
      balancedRequiredRepetitions: balancedRequired,
      requiredDecisionInvocations,
      projectedPlanningCredits,
      creditProjectionBasis: 'published-average-range-upper-end-not-cap',
      oneCallCreditOvershootPossible: true,
      ablationBudgetStatus: 'requires-separate-gate-d-budget-or-approved-e13-amendment',
      approvedHumanCreditCeiling: ceiling === null
        ? { status: 'unknown', reason: 'a human has not approved a calibration credit ceiling' }
        : { status: 'known', value: ceiling },
      status: blocker ? 'evidence-design-blocker' : 'selected',
      selectedBalancedRepetitions: blocker ? null : balancedRequired,
      blocker,
      prohibitedFieldsAbsent: true,
    };
    assertBlindedReport(report);
    return report;
  }
}

export function assertBlindedReport(report: BlindedSampleSizeReport): void {
  exactKeys(report, [
    'ablationBudgetStatus', 'approvedHumanCreditCeiling', 'balancedRequiredRepetitions',
    'blindState', 'blocker', 'creditProjectionBasis', 'endpointRequirements', 'groupCount', 'observationCount',
    'oneCallCreditOvershootPossible', 'policyId', 'pooledDegreesOfFreedom', 'prohibitedFieldsAbsent',
    'projectedPlanningCredits', 'requiredDecisionInvocations', 'residualModel', 'schemaVersion',
    'selectedBalancedRepetitions', 'status',
  ], 'blinded report');
  for (const endpoint of report.endpointRequirements) {
    exactKeys(endpoint, [
      'decisionTaskCountK', 'endpoint', 'endpointRequiredRepetitions', 'familyAlpha', 'planningBasis',
      'powerRequiredRepetitions', 'precisionRequiredRepetitions', 'purpose', 'residualVariance',
      'transformed', 'upperVariance', 'varianceFloor',
    ], `blinded endpoint ${endpoint.endpoint}`);
    exactKeys(endpoint.planningBasis, ['kind', 'plannedValue', 'threshold', 'transformedGap'],
      `blinded endpoint basis ${endpoint.endpoint}`);
  }
  if (report.approvedHumanCreditCeiling.status === 'known') {
    exactKeys(report.approvedHumanCreditCeiling, ['status', 'value'], 'known ceiling');
  } else exactKeys(report.approvedHumanCreditCeiling, ['reason', 'status'], 'unknown ceiling');
  const keys = Object.keys(report).concat(
    report.endpointRequirements.flatMap((endpoint) => Object.keys(endpoint)),
  ).map((key) => key.toLowerCase());
  for (const prohibited of PROHIBITED_REPORT_KEYS) {
    if (keys.some((key) => key === prohibited || key.startsWith(`${prohibited}_`) || key.endsWith(`_${prohibited}`))) {
      throw new Error(`blinded report exposes prohibited field: ${prohibited}`);
    }
  }
}

function exactKeys(value: object, expected: string[], label: string): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.join('\0') !== wanted.join('\0')) throw new Error(`${label} field set mismatch`);
}

function latinSquareResidualVariance(
  observations: BlindedCalibrationObservation[],
  values: number[],
): number {
  let residualSumSquares = 0;
  for (const taskId of [...new Set(observations.map((observation) => observation.taskId))].sort()) {
    const indexes = observations.map((observation, index) => ({ observation, index }))
      .filter(({ observation }) => observation.taskId === taskId);
    const taskGrand = average(indexes.map(({ index }) => values[index]));
    const treatmentMarginals = marginal(indexes, values, ({ observation }) => observation.opaqueTreatment);
    const blockMarginals = marginal(indexes, values, ({ observation }) => observation.blockId);
    const positionMarginals = marginal(indexes, values, ({ observation }) => String(observation.position));
    for (const { observation, index } of indexes) {
      const fitted = treatmentMarginals.get(observation.opaqueTreatment)! +
        blockMarginals.get(observation.blockId)! +
        positionMarginals.get(String(observation.position))! - (2 * taskGrand);
      residualSumSquares += (values[index] - fitted) ** 2;
    }
  }
  return residualSumSquares / 4;
}

function marginal(
  indexes: Array<{ observation: BlindedCalibrationObservation; index: number }>,
  values: number[],
  key: (item: { observation: BlindedCalibrationObservation; index: number }) => string,
): Map<string, number> {
  const groups = new Map<string, number[]>();
  for (const item of indexes) groups.set(key(item), [...(groups.get(key(item)) ?? []), values[item.index]]);
  return new Map([...groups].map(([name, group]) => [name, average(group)]));
}

function endpointValue(
  observation: BlindedCalibrationObservation,
  endpoint: CalibrationAnalysisPolicy['design']['endpoints'][number]['id'],
) {
  if (endpoint === 'correctness' || endpoint === 'proof') return observation.outcomes[endpoint];
  return observation.telemetry[endpoint];
}

function validatePolicy(policy: CalibrationAnalysisPolicy): void {
  const endpointIds = policy.design.endpoints.map((endpoint) => endpoint.id);
  const expected = ['consumedPlanCredits', 'correctness', 'inputTokens', 'proof', 'toolLoops', 'wallMilliseconds'];
  if (
    policy.schemaVersion !== 1 || !policy.policyId ||
    !Number.isFinite(policy.design.power) ||
    policy.design.power <= 0 || policy.design.power >= 1 ||
    policy.design.balancedRepetitionMultiple !== 6 ||
    policy.design.minimumBalancedRepetitions !== 6 ||
    policy.design.residualDegreesOfFreedom !== 4 ||
    policy.design.planningCreditsPerInvocation.value !== 40 ||
    policy.design.planningCreditsPerInvocation.classification !== 'published-average-range-upper-end-not-cap' ||
    policy.design.planningCreditsPerInvocation.oneCallOvershootPossible !== true ||
    policy.design.primaryAndCumulativeInvocationsPerRepetition !== 57 ||
    policy.design.ablationInvocationsPerRepetition !== null ||
    policy.design.varianceFamily.endpointCount !== 6 ||
    !Number.isFinite(policy.design.varianceFamily.alpha) || policy.design.varianceFamily.alpha <= 0 ||
    endpointIds.sort().join('\0') !== expected.join('\0') ||
    policy.design.endpoints.some((endpoint) =>
      !Number.isFinite(endpoint.precisionHalfWidth) || endpoint.precisionHalfWidth <= 0 ||
      !Number.isFinite(endpoint.designDelta) || endpoint.designDelta <= 0 ||
      !Number.isFinite(endpoint.varianceFloor) || endpoint.varianceFloor <= 0 ||
      !Number.isFinite(endpoint.oneSidedAlpha) || endpoint.oneSidedAlpha <= 0 || endpoint.oneSidedAlpha >= 1 ||
      !Number.isFinite(endpoint.varianceTailAlpha) || endpoint.varianceTailAlpha <= 0 ||
      endpoint.varianceTailAlpha >= 1 ||
      endpoint.varianceTailAlpha !== policy.design.varianceFamily.alpha / policy.design.varianceFamily.endpointCount ||
      !['non-inferiority', 'material-benefit', 'guardrail'].includes(endpoint.purpose) ||
      !Number.isFinite(endpoint.familyAlpha) || endpoint.familyAlpha <= 0 || endpoint.familyAlpha >= 1 ||
      endpoint.decisionTaskCountK !== (endpoint.purpose === 'non-inferiority' ? 2 : 16) ||
      !Number.isFinite(endpoint.planningBasis.threshold) ||
      !Number.isFinite(endpoint.planningBasis.plannedValue) ||
      !Number.isFinite(endpoint.planningBasis.transformedGap) || endpoint.planningBasis.transformedGap <= 0 ||
      endpoint.designDelta !== endpoint.planningBasis.transformedGap) ||
    (policy.approvedHumanCreditCeiling !== null &&
      (!Number.isFinite(policy.approvedHumanCreditCeiling) || policy.approvedHumanCreditCeiling <= 0))
  ) throw new Error('calibration analysis policy is invalid');
}

function validateObservations(observations: BlindedCalibrationObservation[]): void {
  if (observations.length !== 18) throw new Error('calibration analysis requires exactly 18 observations');
  const expectedTasks = [
    CALIBRATION_TASK_IDS[0], CALIBRATION_TASK_IDS[1], CALIBRATION_TASK_IDS[0],
    CALIBRATION_TASK_IDS[1], CALIBRATION_TASK_IDS[0], CALIBRATION_TASK_IDS[1],
  ];
  const byTaskBlock = new Map<string, Set<string>>();
  for (const [index, observation] of observations.entries()) {
    const expectedBlock = `B${String(Math.floor(index / 3) + 1).padStart(2, '0')}`;
    if (observation.taskId !== expectedTasks[Math.floor(index / 3)] ||
      observation.blockId !== expectedBlock || observation.position !== index % 3) {
      throw new Error('calibration observations differ from the exact contiguous schedule');
    }
    if (!observation.taskId || !observation.blockId || !observation.opaqueTreatment ||
      ![0, 1, 2].includes(observation.position)) throw new Error('calibration observation is malformed');
    const key = `${observation.taskId}:${observation.blockId}`;
    const group = byTaskBlock.get(key) ?? new Set<string>();
    if (group.has(observation.opaqueTreatment)) throw new Error('calibration block repeats an opaque treatment');
    group.add(observation.opaqueTreatment);
    byTaskBlock.set(key, group);
    for (const [name, metric] of Object.entries({ ...observation.outcomes, ...observation.telemetry })) {
      if (metric.status === 'known') {
        if (!Number.isFinite(metric.value) || metric.value < 0 ||
          ((name === 'correctness' || name === 'proof') && metric.value > 1) ||
          (['inputTokens', 'wallMilliseconds', 'consumedPlanCredits'].includes(name) && metric.value === 0)) {
          throw new Error(`calibration measurement ${name} has an invalid known value`);
        }
      } else if (!metric.reason) throw new Error(`calibration measurement ${name} has an empty unknown reason`);
    }
    if (observation.telemetry.costUsd.status !== 'unknown') {
      throw new Error('ChatGPT-plan calibration USD must remain typed unknown');
    }
  }
  const taskIds = [...new Set(observations.map((observation) => observation.taskId))].sort();
  if (taskIds.join('\0') !== [...CALIBRATION_TASK_IDS].sort().join('\0') || byTaskBlock.size !== 6 ||
    [...byTaskBlock.values()].some((group) => group.size !== 3)) {
    throw new Error('calibration observations must form two task-specific 3x3 Latin squares');
  }
  for (const taskId of taskIds) {
    const task = observations.filter((observation) => observation.taskId === taskId);
    const taskLabels = new Set(task.map((observation) => observation.opaqueTreatment));
    if (taskLabels.size !== 3) throw new Error('calibration task must contain exactly three opaque labels');
    for (const treatment of taskLabels) {
      const positions = task.filter((observation) => observation.opaqueTreatment === treatment)
        .map((observation) => observation.position).sort();
      if (positions.join(',') !== '0,1,2') throw new Error('calibration task is not position-balanced');
    }
  }
  if (new Set(observations.map((observation) => observation.opaqueTreatment)).size !== 3) {
    throw new Error('calibration must contain exactly three opaque labels globally');
  }
}

function average(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function roundUp(value: number, multiple: number): number {
  return Math.ceil(value / multiple) * multiple;
}

function inverseNormal(probability: number): number {
  if (probability <= 0 || probability >= 1) throw new Error('normal probability must be between zero and one');
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269,
    -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972,
    -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734,
    4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  if (probability < 0.02425) {
    const q = Math.sqrt(-2 * Math.log(probability));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (probability > 0.97575) return -inverseNormal(1 - probability);
  const q = probability - 0.5;
  const r = q * q;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q /
    (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

function chiSquareLowerDf4(probability: number): number {
  if (probability <= 0 || probability >= 1) throw new Error('chi-square probability must be between zero and one');
  let low = 0;
  let high = 100;
  for (let iteration = 0; iteration < 200; iteration += 1) {
    const midpoint = (low + high) / 2;
    const half = midpoint / 2;
    const cdf = 1 - Math.exp(-half) * (1 + half);
    if (cdf < probability) low = midpoint;
    else high = midpoint;
  }
  return (low + high) / 2;
}
