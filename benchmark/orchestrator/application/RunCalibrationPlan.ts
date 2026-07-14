import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { CALIBRATION_PLANNED_INVOCATIONS, assertHeldOutCalibrationPlan } from '../domain/calibration';
import { evaluationPlanSemanticSha256, type EvaluationPlan, type RawCellRecord } from '../domain/evaluation';

const REQUIRED_TELEMETRY = [
  'inputTokens',
  'wallMilliseconds',
  'toolLoops',
  'consumedPlanCredits',
] as const;

export interface CalibrationRunReceipt {
  schemaVersion: 1;
  scope: 'held-out-calibration-only';
  runId: string;
  runnerCommit: string;
  executionPlanSha256: string;
  executableSha256: string;
  authorizationSha256: string;
  protocolSha256: string;
  pricingPolicySha256: string;
  toolPolicySha256: string;
  plannedInvocations: 18;
  attemptedInvocations: number;
  completedInvocations: number;
  status: 'complete' | 'stopped-invalid';
  stopReason: string | null;
}

interface CalibrationCellRunner {
  execute(plan: EvaluationPlan, cell: EvaluationPlan['cells'][number]): Promise<RawCellRecord>;
}

export class RunCalibrationPlan {
  constructor(
    private readonly runCell: CalibrationCellRunner,
    private readonly runDir: string,
  ) {}

  async execute(plan: EvaluationPlan): Promise<{
    records: RawCellRecord[];
    receipt: CalibrationRunReceipt;
  }> {
    assertHeldOutCalibrationPlan(plan);
    const records: RawCellRecord[] = [];
    let attemptedInvocations = 0;
    let completedInvocations = 0;
    for (const cell of plan.cells) {
      attemptedInvocations += 1;
      let record: RawCellRecord;
      try {
        record = await this.runCell.execute(plan, cell);
      } catch (error) {
        const receipt = this.receipt(plan, attemptedInvocations, completedInvocations,
          `cell-execution-error:${cell.id}`);
        await this.writeReceipt(receipt);
        throw new CalibrationExecutionStoppedError(receipt, error);
      }
      records.push(record);
      if (record.process.exitCode !== null) completedInvocations += 1;
      const stopReason = calibrationStopReason(record);
      if (stopReason) {
        const receipt = this.receipt(plan, attemptedInvocations, completedInvocations, stopReason);
        await this.writeReceipt(receipt);
        return { records, receipt };
      }
    }
    const receipt = this.receipt(plan, attemptedInvocations, completedInvocations, null);
    await this.writeReceipt(receipt);
    return { records, receipt };
  }

  private receipt(
    plan: EvaluationPlan,
    attemptedInvocations: number,
    completedInvocations: number,
    stopReason: string | null,
  ): CalibrationRunReceipt {
    if (plan.agent.kind !== 'codex') throw new Error('held-out calibration receipt requires Codex identities');
    return {
      schemaVersion: 1,
      scope: 'held-out-calibration-only',
      runId: plan.runId,
      runnerCommit: plan.runner.commit,
      executionPlanSha256: evaluationPlanSemanticSha256(plan),
      executableSha256: plan.agent.executable.sha256,
      authorizationSha256: plan.agent.authorization.sha256,
      protocolSha256: plan.agent.protocol.sha256,
      pricingPolicySha256: plan.agent.pricingPolicy.sha256,
      toolPolicySha256: plan.agent.toolPolicy.sha256,
      plannedInvocations: CALIBRATION_PLANNED_INVOCATIONS,
      attemptedInvocations,
      completedInvocations,
      status: stopReason === null ? 'complete' : 'stopped-invalid',
      stopReason,
    };
  }

  private async writeReceipt(receipt: CalibrationRunReceipt): Promise<void> {
    const directory = path.join(this.runDir, 'calibration-only');
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, 'run-receipt.json'), canonicalJson(receipt), { flag: 'wx' });
  }
}

export class CalibrationExecutionStoppedError extends Error {
  constructor(
    readonly receipt: CalibrationRunReceipt,
    readonly cause: unknown,
  ) {
    super(`held-out calibration stopped after ${receipt.attemptedInvocations} attempted invocation(s): ${receipt.stopReason}`);
    this.name = 'CalibrationExecutionStoppedError';
  }
}

export function assertCompleteCalibrationRunReceipt(
  value: unknown,
  plan: EvaluationPlan,
): CalibrationRunReceipt {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('calibration run receipt is malformed');
  }
  const receipt = value as Record<string, unknown>;
  const actual = Object.keys(receipt).sort();
  const expected = [
    'attemptedInvocations', 'authorizationSha256', 'completedInvocations',
    'executableSha256', 'executionPlanSha256', 'plannedInvocations', 'pricingPolicySha256',
    'protocolSha256', 'runId', 'runnerCommit', 'schemaVersion', 'scope', 'status',
    'stopReason', 'toolPolicySha256',
  ].sort();
  if (actual.join('\0') !== expected.join('\0')) throw new Error('calibration run receipt field set mismatch');
  if (
    receipt.schemaVersion !== 1 || receipt.scope !== 'held-out-calibration-only' ||
    receipt.runId !== plan.runId || receipt.plannedInvocations !== CALIBRATION_PLANNED_INVOCATIONS ||
    receipt.runnerCommit !== plan.runner.commit || receipt.executionPlanSha256 !== evaluationPlanSemanticSha256(plan) ||
    plan.agent.kind !== 'codex' || receipt.executableSha256 !== plan.agent.executable.sha256 ||
    receipt.authorizationSha256 !== plan.agent.authorization.sha256 ||
    receipt.protocolSha256 !== plan.agent.protocol.sha256 ||
    receipt.pricingPolicySha256 !== plan.agent.pricingPolicy.sha256 ||
    receipt.toolPolicySha256 !== plan.agent.toolPolicy.sha256 ||
    receipt.attemptedInvocations !== CALIBRATION_PLANNED_INVOCATIONS ||
    receipt.completedInvocations !== CALIBRATION_PLANNED_INVOCATIONS ||
    receipt.status !== 'complete' || receipt.stopReason !== null
  ) throw new Error('calibration run receipt is not a complete valid 18-call run');
  return value as CalibrationRunReceipt;
}

export function calibrationStopReason(record: RawCellRecord): string | null {
  if (record.status === 'invalid') return `cell-invalid:${record.cellId}`;
  if (record.process.timedOut) return `process-timeout:${record.cellId}`;
  if (record.process.signal !== null) return `process-signal:${record.cellId}:${record.process.signal}`;
  if (record.process.exitCode !== 0) return `process-failure:${record.cellId}:${record.process.exitCode ?? 'missing'}`;
  if (record.status !== 'passed' || record.rubric.effective.some((result) => !result.effectivePass)) {
    return `rubric-failure:${record.cellId}`;
  }
  for (const name of REQUIRED_TELEMETRY) {
    if (record.metrics[name].status === 'unknown') {
      return `required-telemetry-unknown:${record.cellId}:${name}`;
    }
  }
  if (record.metrics.costUsd.status !== 'unknown') return `chatgpt-plan-usd-known:${record.cellId}`;
  return null;
}

function canonicalJson(value: unknown): string {
  return `${JSON.stringify(canonicalize(value), null, 2)}\n`;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonicalize(item)]));
  }
  return value;
}
