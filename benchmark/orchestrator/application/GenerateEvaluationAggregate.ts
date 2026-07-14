import { createHash } from 'node:crypto';
import { lstat, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  effectiveRubricResults,
  type EvaluationAggregate,
  type EvaluationCellSpec,
  type EvaluationPlan,
  type RawCellRecord,
} from '../domain/evaluation';
import type { EvaluationRubricEvaluator, LoadedRubric } from '../ports/EvaluationRubricEvaluator';

export class GenerateEvaluationAggregate {
  constructor(private readonly rubric: EvaluationRubricEvaluator) {}

  async build(plan: EvaluationPlan, runDir: string): Promise<EvaluationAggregate> {
    const cellDir = path.join(runDir, 'cells');
    const expectedFiles = plan.cells.map((cell) => `${safe(cell.id)}.json`).sort();
    const actualFiles = (await readdir(cellDir)).sort();
    if (actualFiles.join('\0') !== expectedFiles.join('\0')) {
      throw new Error(
        `raw cell set mismatch: expected [${expectedFiles.join(', ')}], got [${actualFiles.join(', ')}]`,
      );
    }

    const sourceCells: EvaluationAggregate['sourceCells'] = [];
    const cells: EvaluationAggregate['cells'] = [];
    let primaryPass = 0;
    let primaryTotal = 0;
    let unknownMetrics = 0;
    const priorStatuses = new Map<string, RawCellRecord['status']>();
    for (const cell of plan.cells) {
      const rawPath = path.join(cellDir, `${safe(cell.id)}.json`);
      const details = await lstat(rawPath);
      if (!details.isFile() || details.isSymbolicLink()) {
        throw new Error(`raw cell record is not a regular file: ${cell.id}`);
      }
      const bytes = await readFile(rawPath);
      const record = JSON.parse(bytes.toString('utf8')) as RawCellRecord;
      const loaded = await this.rubric.load(cell, plan.corpus.root);
      validateRecord(record, plan, cell, loaded);
      const expectedBlockedBy = cell.dependencies.filter(
        (dependency) => priorStatuses.get(dependency) !== 'passed',
      );
      if (
        (expectedBlockedBy.length > 0 &&
          (record.status !== 'blocked_dependency' ||
            record.blockedBy?.join('\0') !== expectedBlockedBy.join('\0'))) ||
        (expectedBlockedBy.length === 0 && record.status === 'blocked_dependency')
      ) {
        throw new Error(`dependency outcome mismatch: ${cell.id}`);
      }
      await validateEvidence(record, runDir, cell);
      const pass = record.rubric.effective.filter((result) => result.effectivePass).length;
      const total = loaded.checkIds.length;
      primaryPass += pass;
      primaryTotal += total;
      unknownMetrics += Object.values(record.metrics).filter(
        (metric) => metric.status === 'unknown',
      ).length;
      sourceCells.push({ cellId: cell.id, sha256: sha256(bytes) });
      cells.push({ cellId: cell.id, status: record.status, primaryPass: pass, primaryTotal: total });
      priorStatuses.set(cell.id, record.status);
    }
    return {
      version: 1,
      runId: plan.runId,
      expectedCellIds: plan.cells.map((cell) => cell.id),
      sourceCells,
      cells,
      primaryPass,
      primaryTotal,
      unknownMetrics,
    };
  }

  async write(plan: EvaluationPlan, runDir: string): Promise<EvaluationAggregate> {
    const aggregate = await this.build(plan, runDir);
    await writeFile(path.join(runDir, 'aggregate.json'), canonicalJson(aggregate), { flag: 'wx' });
    return aggregate;
  }

  async verify(plan: EvaluationPlan, runDir: string): Promise<EvaluationAggregate> {
    const aggregatePath = path.join(runDir, 'aggregate.json');
    const details = await lstat(aggregatePath);
    if (!details.isFile() || details.isSymbolicLink()) {
      throw new Error('aggregate is not a regular file');
    }
    const actual = await readFile(aggregatePath, 'utf8');
    const expected = await this.build(plan, runDir);
    if (actual !== canonicalJson(expected)) throw new Error('aggregate content does not match raw cell records');
    return expected;
  }
}

function validateRecord(
  record: RawCellRecord,
  plan: EvaluationPlan,
  cell: EvaluationCellSpec,
  loaded: LoadedRubric,
): void {
  if (!record || typeof record !== 'object') throw new Error(`malformed raw record: ${cell.id}`);
  if (
    record.version !== 1 ||
    record.runId !== plan.runId ||
    record.cellId !== cell.id ||
    record.mode !== cell.mode ||
    record.dependencies?.join('\0') !== cell.dependencies.join('\0')
  ) {
    throw new Error(`raw record plan identity mismatch: ${cell.id}`);
  }
  same(record.identities?.runner, plan.runner, `runner identity ${cell.id}`);
  same(record.identities?.corpus, plan.corpus, `corpus identity ${cell.id}`);
  same(record.identities?.model, plan.model, `model identity ${cell.id}`);
  same(record.identities?.order, cell.order, `order identity ${cell.id}`);
  if (
    record.identities?.sandbox !== plan.sandbox ||
    record.identities?.toolCatalogSha256 !== plan.toolCatalogSha256
  ) {
    throw new Error(`execution identity mismatch: ${cell.id}`);
  }
  const treatment = record.identities?.treatment;
  for (const key of ['path', 'sha256', 'sourceRoot', 'profile', 'platform', 'artifactCache'] as const) {
    if (treatment?.[key] !== cell.treatment[key]) {
      throw new Error(`treatment identity mismatch for ${cell.id}: ${key}`);
    }
  }
  if (
    record.identities?.fixture?.taskId !== loaded.taskId ||
    record.identities?.fixture?.fixtureSha256 !== loaded.fixtureSha256 ||
    record.identities?.fixture?.startCommit !== loaded.startCommit ||
    record.identities?.prompt?.sha256 !== loaded.promptSha256 ||
    record.identities?.rubric?.sha256 !== loaded.rubricSha256 ||
    record.identities?.rubric?.runnerSha256 !== loaded.rubricRunnerSha256 ||
    record.identities?.rubric?.checkIds?.join('\0') !== loaded.checkIds.join('\0') ||
    record.rubric?.expectedCheckIds?.join('\0') !== loaded.checkIds.join('\0')
  ) {
    throw new Error(`frozen task identity mismatch: ${cell.id}`);
  }
  assertSha256(record.identities.fixture.materializedTreeSha256, `${cell.id} fixture tree`);
  assertSha256(record.process?.stdoutSha256, `${cell.id} stdout`);
  assertSha256(record.process?.stderrSha256, `${cell.id} stderr`);
  validateMetrics(record, cell.id);
  if (record.workspace?.disposed !== true) throw new Error(`workspace was not disposed: ${cell.id}`);

  if (record.status === 'blocked_dependency') {
    if (
      cell.mode !== 'cumulative' ||
      !Array.isArray(record.blockedBy) ||
      record.blockedBy.length === 0 ||
      new Set(record.blockedBy).size !== record.blockedBy.length ||
      record.blockedBy.some((dependency) => !cell.dependencies.includes(dependency))
    ) {
      throw new Error(`invalid dependency block record: ${cell.id}`);
    }
    if (record.process.exitCode !== null || record.rubric.observed.length !== 0) {
      throw new Error(`blocked cell was invoked or scored: ${cell.id}`);
    }
    if (
      record.rubric.effective.length !== loaded.checkIds.length ||
      record.rubric.effective.some((result, index) =>
        result.id !== loaded.checkIds[index] || result.effectivePass || !result.blockedByProcess)
    ) {
      throw new Error(`blocked cell effective score is invalid: ${cell.id}`);
    }
    return;
  }

  if (record.status !== 'passed' && record.status !== 'failed') {
    throw new Error(`unsupported raw cell status: ${cell.id}`);
  }
  if (!Number.isInteger(record.process.exitCode)) throw new Error(`missing process exit code: ${cell.id}`);
  if (record.process.timedOut && record.process.exitCode !== 124) {
    throw new Error(`timeout exit code is not authoritative: ${cell.id}`);
  }
  const observedIds = record.rubric.observed.map((result) => result.id);
  if (observedIds.join('\0') !== loaded.checkIds.join('\0')) {
    throw new Error(`observed rubric check set mismatch: ${cell.id}`);
  }
  const expectedEffective = effectiveRubricResults(
    loaded.checkIds,
    record.rubric.observed,
    record.process.exitCode as number,
  );
  same(record.rubric.effective, expectedEffective, `effective rubric results ${cell.id}`);
  const expectedStatus = record.process.exitCode === 0 && expectedEffective.every((result) => result.effectivePass)
    ? 'passed'
    : 'failed';
  if (record.status !== expectedStatus) throw new Error(`cell status does not match primary score: ${cell.id}`);
  if (!record.treatmentApplication || record.treatmentApplication.candidateId !== treatment.candidateId) {
    throw new Error(`missing or mismatched treatment application receipt: ${cell.id}`);
  }
  if (
    record.treatmentApplication.manifestSha256 !== cell.treatment.sha256 ||
    record.treatmentApplication.activationProfile !== cell.treatment.profile ||
    record.treatmentApplication.platform !== cell.treatment.platform ||
    record.treatmentApplication.stagedTreeSha256 !== treatment.stagedTreeSha256 ||
    record.treatmentApplication.resultingTreeSha256 !== treatment.appliedTreeSha256 ||
    record.treatmentApplication.visibleInstructionProof?.allDeclaredInstructionsVisible !== true
  ) {
    throw new Error(`treatment application identity mismatch: ${cell.id}`);
  }
  for (const value of [
    record.rubric.scoreReceiptSha256,
    record.workspace.beforeSha256,
    record.workspace.afterSha256,
    record.workspace.diffSha256,
  ]) {
    assertSha256(value, `${cell.id} receipt or workspace identity`);
  }
}

async function validateEvidence(
  record: RawCellRecord,
  runDir: string,
  cell: EvaluationCellSpec,
): Promise<void> {
  if (record.status === 'blocked_dependency') {
    if (record.evidence !== undefined) throw new Error(`blocked cell has execution evidence: ${cell.id}`);
    return;
  }
  const expected = {
    stdout: path.posix.join('evidence', safe(cell.id), 'stdout.bin'),
    stderr: path.posix.join('evidence', safe(cell.id), 'stderr.bin'),
    fixtureReceipt: path.posix.join('evidence', safe(cell.id), 'fixture-receipt.json'),
    rubricStartReceipt: path.posix.join('evidence', safe(cell.id), 'rubric-start-receipt.json'),
    metricsReceipt: path.posix.join('evidence', safe(cell.id), 'metrics-receipt.json'),
    workspaceDiff: path.posix.join('evidence', safe(cell.id), 'workspace-diff.bin'),
    scoreReceipt: path.posix.join('evidence', safe(cell.id), 'score-receipt.json'),
    treatmentApplicationReceipt: path.posix.join(
      'evidence',
      safe(cell.id),
      'treatment-application-receipt.json',
    ),
  };
  const evidence = record.evidence;
  if (!evidence) throw new Error(`missing execution evidence: ${cell.id}`);
  for (const name of Object.keys(expected) as Array<keyof typeof expected>) {
    const ref = evidence[name];
    if (!ref || ref.path !== expected[name]) throw new Error(`missing evidence ${name}: ${cell.id}`);
    assertSha256(ref.sha256, `${cell.id} evidence ${name}`);
    const absolute = path.join(runDir, ref.path);
    const details = await lstat(absolute);
    if (!details.isFile() || details.isSymbolicLink()) {
      throw new Error(`evidence is not a regular file: ${ref.path}`);
    }
    const digest = sha256(await readFile(absolute));
    if (digest !== ref.sha256) throw new Error(`evidence checksum mismatch: ${ref.path}`);
  }
  if (
    evidence.stdout.sha256 !== record.process.stdoutSha256 ||
    evidence.stderr.sha256 !== record.process.stderrSha256 ||
    evidence.workspaceDiff.sha256 !== record.workspace.diffSha256 ||
    evidence.scoreReceipt.sha256 !== record.rubric.scoreReceiptSha256
  ) {
    throw new Error(`evidence references do not match raw record hashes: ${cell.id}`);
  }
  const applicationReceipt = JSON.parse(
    await readFile(path.join(runDir, evidence.treatmentApplicationReceipt.path), 'utf8'),
  ) as unknown;
  same(applicationReceipt, record.treatmentApplication, `treatment application receipt ${cell.id}`);
  const fixtureReceipt = JSON.parse(
    await readFile(path.join(runDir, evidence.fixtureReceipt.path), 'utf8'),
  ) as Record<string, unknown>;
  const rubricStartReceipt = JSON.parse(
    await readFile(path.join(runDir, evidence.rubricStartReceipt.path), 'utf8'),
  ) as Record<string, unknown>;
  for (const receipt of [fixtureReceipt, rubricStartReceipt]) {
    if (
      receipt.taskId !== record.identities.fixture.taskId ||
      receipt.fixtureSha256 !== record.identities.fixture.fixtureSha256 ||
      receipt.startCommit !== record.identities.fixture.startCommit
    ) {
      throw new Error(`retained rubric start identity mismatch: ${cell.id}`);
    }
  }
  if (fixtureReceipt.materializedTreeSha256 !== record.identities.fixture.materializedTreeSha256) {
    throw new Error(`retained fixture tree identity mismatch: ${cell.id}`);
  }
  const startFiles = rubricStartReceipt.files;
  if (!startFiles || typeof startFiles !== 'object' || Array.isArray(startFiles)) {
    throw new Error(`retained rubric start file map is missing: ${cell.id}`);
  }
  if (rubricStartReceipt.materializedTreeSha256 !== sha256(compactCanonical({ files: startFiles }))) {
    throw new Error(`retained rubric start tree identity mismatch: ${cell.id}`);
  }
  const diff = JSON.parse(
    await readFile(path.join(runDir, evidence.workspaceDiff.path), 'utf8'),
  ) as { schemaVersion?: number; changes?: unknown[] };
  if (diff.schemaVersion !== 1 || !Array.isArray(diff.changes)) {
    throw new Error(`retained workspace change manifest is malformed: ${cell.id}`);
  }
  const seenPaths = new Set<string>();
  for (const value of diff.changes) {
    const change = value as Record<string, unknown>;
    if (typeof change.path !== 'string' || change.path === '' || seenPaths.has(change.path)) {
      throw new Error(`retained workspace change path is invalid: ${cell.id}`);
    }
    seenPaths.add(change.path);
    if (change.afterSha256 === null) {
      if (change.contentBase64 !== null) throw new Error(`deleted change retains content: ${cell.id}`);
    } else {
      assertSha256(change.afterSha256, `${cell.id} retained change`);
      if (
        typeof change.contentBase64 !== 'string' ||
        sha256(Buffer.from(change.contentBase64, 'base64')) !== change.afterSha256
      ) {
        throw new Error(`retained changed-file bytes mismatch: ${cell.id}`);
      }
    }
  }
  const metricsReceipt = JSON.parse(
    await readFile(path.join(runDir, evidence.metricsReceipt.path), 'utf8'),
  ) as { schemaVersion?: number; emitted?: boolean; values?: Record<string, unknown> | null };
  if (metricsReceipt.schemaVersion !== 1 || typeof metricsReceipt.emitted !== 'boolean') {
    throw new Error(`metrics receipt is malformed: ${cell.id}`);
  }
  for (const name of ['inputTokens', 'outputTokens', 'costUsd'] as const) {
    const metric = record.metrics[name];
    const emitted = metricsReceipt.values?.[name];
    if (metricsReceipt.emitted && typeof emitted === 'number' && Number.isFinite(emitted)) {
      if (metric.status !== 'known' || metric.value !== emitted) {
        throw new Error(`known metric differs from retained receipt: ${name} ${cell.id}`);
      }
    } else if (metric.status !== 'unknown') {
      throw new Error(`missing metric was converted to a numeric value: ${name} ${cell.id}`);
    }
  }
}

function validateMetrics(record: RawCellRecord, cellId: string): void {
  for (const [name, metric] of Object.entries(record.metrics ?? {})) {
    if (metric.status === 'known') {
      if (typeof metric.value !== 'number' || !Number.isFinite(metric.value) || metric.value < 0) {
        throw new Error(`invalid known metric ${name}: ${cellId}`);
      }
    } else if (metric.status === 'unknown') {
      if (typeof metric.reason !== 'string' || metric.reason === '') {
        throw new Error(`invalid unknown metric ${name}: ${cellId}`);
      }
    } else {
      throw new Error(`metric ${name} has no known/unknown status: ${cellId}`);
    }
  }
  if (Object.keys(record.metrics ?? {}).sort().join('\0') !==
      ['costUsd', 'inputTokens', 'outputTokens', 'wallMilliseconds'].sort().join('\0')) {
    throw new Error(`metric set mismatch: ${cellId}`);
  }
}

function same(actual: unknown, expected: unknown, label: string): void {
  if (canonicalJson(actual) !== canonicalJson(expected)) throw new Error(`${label} mismatch`);
}

function safe(value: string): string {
  if (!/^[A-Za-z0-9._-]+$/.test(value)) throw new Error(`unsafe cell id: ${value}`);
  return value;
}

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function assertSha256(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) {
    throw new Error(`${label} must be a lowercase sha256`);
  }
}

function canonicalJson(value: unknown): string {
  return `${JSON.stringify(canonicalize(value), null, 2)}\n`;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalize(item)]),
    );
  }
  return value;
}

function compactCanonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(compactCanonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value as Record<string, unknown>)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${compactCanonical((value as Record<string, unknown>)[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}
