import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  assertHeldOutCalibrationPlan,
  type BlindedCalibrationObservation,
  type BlindedSampleSizeReport,
  type CalibrationAnalysisPolicy,
} from '../domain/calibration';
import type { EvaluationAggregate, EvaluationPlan, RawCellRecord } from '../domain/evaluation';
import type { GenerateEvaluationAggregate } from './GenerateEvaluationAggregate';
import { GenerateCalibrationAggregate } from './GenerateCalibrationAggregate';
import { assertBlindedReport, GenerateCalibrationAnalysis } from './GenerateCalibrationAnalysis';
import { assertCompleteCalibrationRunReceipt } from './RunCalibrationPlan';

export interface FutureDecisionCreditCeilingAuthorization {
  schemaVersion: 1;
  scope: 'future-decision-planning';
  policyId: string;
  approvedHumanCreditCeiling: number;
  authorizesCalibrationExecution: false;
}

export interface BlindedCalibrationReportArtifact {
  schemaVersion: 1;
  scope: 'held-out-calibration-only';
  runId: string;
  blindState: 'group-identities-withheld';
  sourceHashes: {
    frozenPolicySha256: string;
    corpusLockSha256: string;
    atomicCatalogSha256: string;
    calibrationAggregateSha256: string;
    calibrationRunReceiptSha256: string;
    rawCells: Array<{ cellId: string; sha256: string }>;
  };
  futureDecisionCreditCeiling: { inputSha256: string };
  report: BlindedSampleSizeReport;
}

export type RubricDimensions = Map<string, Map<string, 'correctness' | 'proof' | 'safety'>>;

export class GenerateBlindedCalibrationReport {
  constructor(
    private readonly atomic: GenerateEvaluationAggregate,
    private readonly calibration = new GenerateCalibrationAggregate(atomic),
    private readonly analysis = new GenerateCalibrationAnalysis(),
  ) {}

  async write(input: {
    plan: EvaluationPlan;
    runDir: string;
    frozenPolicyPath: string;
    expectedFrozenPolicySha256: string;
    futureDecisionCreditCeilingPath: string;
  }): Promise<BlindedCalibrationReportArtifact> {
    assertHeldOutCalibrationPlan(input.plan);
    const calibrationAggregate = await this.calibration.verify(input.plan, input.runDir);
    if (calibrationAggregate.infrastructureValidity !== 'valid' ||
      calibrationAggregate.completedInvocations !== 18) {
      throw new Error('calibration aggregate is not a complete valid 18-call run');
    }
    const aggregate = await this.atomic.build(input.plan, input.runDir);
    const records = await loadExactRawRecords(input.plan, input.runDir, aggregate);
    const aggregateBytes = await readRegularFile(
      path.join(input.runDir, 'calibration-only/aggregate.json'),
      'calibration aggregate',
    );
    const receiptBytes = await readRegularFile(
      path.join(input.runDir, 'calibration-only/run-receipt.json'),
      'calibration run receipt',
    );
    assertCompleteCalibrationRunReceipt(JSON.parse(receiptBytes.toString('utf8')), input.plan);
    const dimensions = await loadFrozenRubricDimensions(input.plan);
    const policyBytes = await readRegularFile(input.frozenPolicyPath, 'frozen calibration analysis policy');
    if (!/^[a-f0-9]{64}$/.test(input.expectedFrozenPolicySha256) ||
      sha256(policyBytes) !== input.expectedFrozenPolicySha256) {
      throw new Error('frozen calibration analysis policy checksum differs from the locked packet identity');
    }
    const frozenPolicy = JSON.parse(policyBytes.toString('utf8')) as CalibrationAnalysisPolicy;
    if (frozenPolicy.approvedHumanCreditCeiling !== null) {
      throw new Error('frozen calibration policy must not embed a future-decision credit ceiling');
    }
    const ceilingBytes = await readRegularFile(
      input.futureDecisionCreditCeilingPath,
      'future-decision credit-ceiling authorization',
    );
    const ceiling = parseFutureDecisionCreditCeiling(JSON.parse(ceilingBytes.toString('utf8')));
    if (ceiling.policyId !== frozenPolicy.policyId) {
      throw new Error('future-decision credit-ceiling policy identity mismatch');
    }
    const observations = mapRawCellsToBlindedObservations(input.plan, records, dimensions);
    const report = this.analysis.build({
      ...frozenPolicy,
      approvedHumanCreditCeiling: ceiling.approvedHumanCreditCeiling,
    }, observations);
    const artifact: BlindedCalibrationReportArtifact = {
      schemaVersion: 1,
      scope: 'held-out-calibration-only',
      runId: input.plan.runId,
      blindState: 'group-identities-withheld',
      sourceHashes: {
        frozenPolicySha256: sha256(policyBytes),
        corpusLockSha256: input.plan.corpus.lockSha256,
        atomicCatalogSha256: input.plan.corpus.atomicCatalogSha256,
        calibrationAggregateSha256: sha256(aggregateBytes),
        calibrationRunReceiptSha256: sha256(receiptBytes),
        rawCells: aggregate.sourceCells,
      },
      futureDecisionCreditCeiling: { inputSha256: sha256(ceilingBytes) },
      report,
    };
    assertBlindedCalibrationReportArtifact(artifact, input.plan, records);
    const directory = path.join(input.runDir, 'calibration-only');
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, 'blinded-report.json'), canonicalJson(artifact), { flag: 'wx' });
    return artifact;
  }
}

export function mapRawCellsToBlindedObservations(
  plan: EvaluationPlan,
  records: RawCellRecord[],
  rubricDimensions: RubricDimensions,
): BlindedCalibrationObservation[] {
  assertHeldOutCalibrationPlan(plan);
  if (records.length !== plan.cells.length) throw new Error('raw calibration record count mismatch');
  const opaqueByTreatmentSha = new Map(
    [...new Set(plan.cells.map((cell) => cell.treatment.sha256))].sort()
      .map((digest, index) => [digest, `G${String(index + 1).padStart(2, '0')}`]),
  );
  return plan.cells.map((cell, index) => {
    const record = records[index];
    if (
      record.runId !== plan.runId || record.cellId !== cell.id || record.status !== 'passed' ||
      record.identities.treatment.sha256 !== cell.treatment.sha256 ||
      record.identities.fixture.taskId !== cell.taskId ||
      record.identities.order.repetition !== cell.order.repetition ||
      record.identities.order.position !== cell.order.position
    ) throw new Error(`raw calibration identity mismatch: ${cell.id}`);
    if (record.process.exitCode !== 0 || record.process.signal !== null || record.process.timedOut) {
      throw new Error(`raw calibration process is invalid: ${cell.id}`);
    }
    const dimensions = rubricDimensions.get(cell.taskId);
    if (!dimensions) throw new Error(`frozen rubric dimensions missing: ${cell.taskId}`);
    const resultById = new Map(record.rubric.effective.map((result) => [result.id, result]));
    if (resultById.size !== dimensions.size || [...dimensions.keys()].some((id) => !resultById.has(id))) {
      throw new Error(`raw calibration rubric identity mismatch: ${cell.id}`);
    }
    const score = (dimension: 'correctness' | 'proof') => {
      const ids = [...dimensions].filter(([, value]) => value === dimension).map(([id]) => id);
      if (ids.length === 0) throw new Error(`frozen rubric has no ${dimension} dimension: ${cell.taskId}`);
      return { status: 'known' as const,
        value: ids.filter((id) => resultById.get(id)!.effectivePass).length / ids.length };
    };
    if (record.metrics.costUsd.status !== 'unknown') {
      throw new Error(`ChatGPT-plan calibration USD must remain unknown: ${cell.id}`);
    }
    return {
      taskId: cell.taskId,
      blockId: `B${String(Math.floor(index / 3) + 1).padStart(2, '0')}`,
      position: (index % 3) as 0 | 1 | 2,
      opaqueTreatment: opaqueByTreatmentSha.get(cell.treatment.sha256)!,
      outcomes: { correctness: score('correctness'), proof: score('proof') },
      telemetry: {
        inputTokens: record.metrics.inputTokens,
        cachedInputTokens: record.metrics.cachedInputTokens,
        outputTokens: record.metrics.outputTokens,
        wallMilliseconds: record.metrics.wallMilliseconds,
        toolLoops: record.metrics.toolLoops,
        consumedPlanCredits: record.metrics.consumedPlanCredits,
        costUsd: record.metrics.costUsd,
      },
    };
  });
}

export function parseFutureDecisionCreditCeiling(value: unknown): FutureDecisionCreditCeilingAuthorization {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('future-decision credit-ceiling authorization is malformed');
  }
  const authorization = value as Record<string, unknown>;
  exactKeys(authorization, [
    'approvedHumanCreditCeiling', 'authorizesCalibrationExecution', 'policyId', 'schemaVersion', 'scope',
  ], 'future-decision credit-ceiling authorization');
  if (
    authorization.schemaVersion !== 1 || authorization.scope !== 'future-decision-planning' ||
    typeof authorization.policyId !== 'string' || authorization.policyId.length === 0 ||
    typeof authorization.approvedHumanCreditCeiling !== 'number' ||
    !Number.isFinite(authorization.approvedHumanCreditCeiling) ||
    authorization.approvedHumanCreditCeiling <= 0 || authorization.authorizesCalibrationExecution !== false
  ) throw new Error('future-decision credit-ceiling authorization is invalid');
  return authorization as unknown as FutureDecisionCreditCeilingAuthorization;
}

export function assertBlindedCalibrationReportArtifact(
  artifact: BlindedCalibrationReportArtifact,
  plan?: EvaluationPlan,
  records: RawCellRecord[] = [],
): void {
  exactKeys(artifact, [
    'blindState', 'futureDecisionCreditCeiling', 'report', 'runId', 'schemaVersion', 'scope', 'sourceHashes',
  ], 'blinded calibration artifact');
  exactKeys(artifact.sourceHashes, [
    'atomicCatalogSha256', 'calibrationAggregateSha256', 'calibrationRunReceiptSha256',
    'corpusLockSha256', 'frozenPolicySha256', 'rawCells',
  ], 'blinded calibration source hashes');
  exactKeys(artifact.futureDecisionCreditCeiling, ['inputSha256'], 'future-decision ceiling hash');
  for (const source of artifact.sourceHashes.rawCells) exactKeys(source, ['cellId', 'sha256'], 'raw cell hash');
  assertBlindedReport(artifact.report);
  const prohibitedKeys = ['treatment', 'label', 'mean', 'rank', 'effect'];
  visitKeys(artifact, (key) => {
    const normalized = key.toLowerCase();
    if (prohibitedKeys.some((item) => normalized === item || normalized.startsWith(`${item}_`) ||
      normalized.endsWith(`_${item}`))) throw new Error(`blinded artifact exposes prohibited field: ${key}`);
  });
  if (plan) {
    const identities = new Set(plan.cells.flatMap((cell) => [cell.treatment.path, cell.treatment.sha256]));
    for (const record of records) {
      if (record.identities.treatment.candidateId) identities.add(record.identities.treatment.candidateId);
    }
    visitStrings(artifact, (value) => {
      if (identities.has(value)) throw new Error('blinded artifact exposes a treatment identity');
    });
  }
}

async function loadExactRawRecords(
  plan: EvaluationPlan,
  runDir: string,
  aggregate: EvaluationAggregate,
): Promise<RawCellRecord[]> {
  return Promise.all(plan.cells.map(async (cell, index) => {
    const bytes = await readRegularFile(path.join(runDir, 'cells', `${cell.id}.json`), `raw cell ${cell.id}`);
    if (sha256(bytes) !== aggregate.sourceCells[index]?.sha256 || aggregate.sourceCells[index]?.cellId !== cell.id) {
      throw new Error(`raw calibration source hash mismatch: ${cell.id}`);
    }
    return JSON.parse(bytes.toString('utf8')) as RawCellRecord;
  }));
}

async function loadFrozenRubricDimensions(plan: EvaluationPlan): Promise<RubricDimensions> {
  const bytes = await readRegularFile(path.join(plan.corpus.root, 'atomic-catalog.json'), 'frozen atomic catalog');
  const catalog = JSON.parse(bytes.toString('utf8')) as { tasks?: Array<{
    id?: string;
    rubric?: { checks?: Array<{ id?: string; dimension?: string }> };
  }> };
  if (sha256(compactCanonical(catalog)) !== plan.corpus.atomicCatalogSha256) {
    throw new Error('frozen atomic catalog semantic checksum mismatch');
  }
  const result: RubricDimensions = new Map();
  for (const task of catalog.tasks ?? []) {
    if (!task.id || !task.rubric?.checks) continue;
    const dimensions = new Map<string, 'correctness' | 'proof' | 'safety'>();
    for (const check of task.rubric.checks) {
      if (!check.id || !['correctness', 'proof', 'safety'].includes(check.dimension ?? '')) {
        throw new Error(`frozen rubric dimension is invalid: ${task.id}`);
      }
      dimensions.set(check.id, check.dimension as 'correctness' | 'proof' | 'safety');
    }
    result.set(task.id, dimensions);
  }
  return result;
}

async function readRegularFile(filePath: string, label: string): Promise<Buffer> {
  const details = await lstat(filePath);
  if (!details.isFile() || details.isSymbolicLink()) throw new Error(`${label} is not a regular file`);
  return readFile(filePath);
}

function exactKeys(value: Record<string, unknown> | object, expected: string[], label: string): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.join('\0') !== wanted.join('\0')) throw new Error(`${label} field set mismatch`);
}

function visitKeys(value: unknown, visitor: (key: string) => void): void {
  if (Array.isArray(value)) return value.forEach((item) => visitKeys(item, visitor));
  if (!value || typeof value !== 'object') return;
  for (const [key, item] of Object.entries(value)) {
    visitor(key);
    visitKeys(item, visitor);
  }
}

function visitStrings(value: unknown, visitor: (value: string) => void): void {
  if (typeof value === 'string') return visitor(value);
  if (Array.isArray(value)) return value.forEach((item) => visitStrings(item, visitor));
  if (!value || typeof value !== 'object') return;
  Object.values(value).forEach((item) => visitStrings(item, visitor));
}

function compactCanonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(compactCanonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value as Record<string, unknown>).sort()
      .map((key) => `${JSON.stringify(key)}:${compactCanonical((value as Record<string, unknown>)[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
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

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}
