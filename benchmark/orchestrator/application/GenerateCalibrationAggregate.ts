import { lstat, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { EvaluationAggregate, EvaluationPlan, RawCellRecord } from '../domain/evaluation';
import { assertHeldOutCalibrationPlan } from '../domain/calibration';
import type { GenerateEvaluationAggregate } from './GenerateEvaluationAggregate';

export interface CalibrationAggregate {
  version: 1;
  scope: 'held-out-calibration-only';
  excludedFromDecisionCorpus: true;
  excludedFromDecisionAggregate: true;
  runId: string;
  plannedInvocations: 18;
  completedInvocations: number;
  retries: 0;
  infrastructureValidity: 'valid' | 'invalid';
  invalidReasons: string[];
  telemetrySchema: {
    inputTokens: 'known-or-unknown';
    cachedInputTokens: 'known-or-unknown';
    outputTokens: 'known-or-unknown';
    wallMilliseconds: 'known-or-unknown';
    toolLoops: 'known-or-unknown';
    consumedPlanCredits: 'known-or-unknown';
    costUsd: 'unknown-for-chatgpt-plan';
  };
  unknownTelemetryCounts: Record<keyof RawCellRecord['metrics'], number>;
  source: EvaluationAggregate;
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

export class GenerateCalibrationAggregate {
  constructor(private readonly atomic: GenerateEvaluationAggregate) {}

  async build(plan: EvaluationPlan, runDir: string): Promise<CalibrationAggregate> {
    assertHeldOutCalibrationPlan(plan);
    const source = await this.atomic.build(plan, runDir);
    const invalidReasons: string[] = [];
    const counts = {
      wallMilliseconds: 0,
      inputTokens: 0,
      cachedInputTokens: 0,
      outputTokens: 0,
      toolLoops: 0,
      consumedPlanCredits: 0,
      costUsd: 0,
    } satisfies Record<keyof RawCellRecord['metrics'], number>;
    let completedInvocations = 0;
    for (const cell of plan.cells) {
      const raw = JSON.parse(
        await readFile(path.join(runDir, 'cells', `${cell.id}.json`), 'utf8'),
      ) as RawCellRecord;
      if (raw.process.exitCode !== null) completedInvocations += 1;
      if (raw.process.timedOut || raw.process.signal !== null || raw.process.exitCode !== 0) {
        invalidReasons.push(`infrastructure-invalid:${cell.id}`);
      }
      for (const [name, metric] of Object.entries(raw.metrics) as Array<
        [keyof RawCellRecord['metrics'], RawCellRecord['metrics'][keyof RawCellRecord['metrics']]]
      >) {
        if (metric.status === 'unknown') counts[name] += 1;
      }
      if (raw.metrics.costUsd.status !== 'unknown') {
        invalidReasons.push(`chatgpt-plan-usd-became-known:${cell.id}`);
      }
      for (const required of ['inputTokens', 'wallMilliseconds', 'toolLoops', 'consumedPlanCredits'] as const) {
        if (raw.metrics[required].status === 'unknown') {
          invalidReasons.push(`required-sizing-telemetry-unknown:${cell.id}:${required}`);
        }
      }
    }
    if (completedInvocations !== 18) invalidReasons.push('incomplete-calibration-call-set');
    return {
      version: 1,
      scope: 'held-out-calibration-only',
      excludedFromDecisionCorpus: true,
      excludedFromDecisionAggregate: true,
      runId: plan.runId,
      plannedInvocations: 18,
      completedInvocations,
      retries: 0,
      infrastructureValidity: invalidReasons.length === 0 ? 'valid' : 'invalid',
      invalidReasons,
      telemetrySchema: {
        inputTokens: 'known-or-unknown',
        cachedInputTokens: 'known-or-unknown',
        outputTokens: 'known-or-unknown',
        wallMilliseconds: 'known-or-unknown',
        toolLoops: 'known-or-unknown',
        consumedPlanCredits: 'known-or-unknown',
        costUsd: 'unknown-for-chatgpt-plan',
      },
      unknownTelemetryCounts: counts,
      source,
    };
  }

  async write(plan: EvaluationPlan, runDir: string): Promise<CalibrationAggregate> {
    const aggregate = await this.build(plan, runDir);
    const directory = path.join(runDir, 'calibration-only');
    await import('node:fs/promises').then(({ mkdir }) => mkdir(directory, { recursive: true }));
    await writeFile(path.join(directory, 'aggregate.json'), canonicalJson(aggregate), { flag: 'wx' });
    return aggregate;
  }

  async verify(plan: EvaluationPlan, runDir: string): Promise<CalibrationAggregate> {
    const aggregatePath = path.join(runDir, 'calibration-only', 'aggregate.json');
    const details = await lstat(aggregatePath);
    if (!details.isFile() || details.isSymbolicLink()) throw new Error('calibration aggregate is not a regular file');
    const expected = await this.build(plan, runDir);
    if (await readFile(aggregatePath, 'utf8') !== canonicalJson(expected)) {
      throw new Error('calibration aggregate content does not match raw held-out cells');
    }
    return expected;
  }
}
