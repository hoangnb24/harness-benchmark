import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  assertBlindedCalibrationReportArtifact,
  GenerateBlindedCalibrationReport,
  mapRawCellsToBlindedObservations,
  parseFutureDecisionCreditCeiling,
  type BlindedCalibrationReportArtifact,
  type RubricDimensions,
} from '../application/GenerateBlindedCalibrationReport';
import { GenerateCalibrationAnalysis } from '../application/GenerateCalibrationAnalysis';
import { assertCompleteCalibrationRunReceipt, RunCalibrationPlan } from '../application/RunCalibrationPlan';
import type { BlindedSampleSizeReport, CalibrationAnalysisPolicy } from '../domain/calibration';
import type { EvaluationPlan, KnownOrUnknown, RawCellRecord } from '../domain/evaluation';
import { codexExecutionPlanSha } from '../infrastructure/CodexExecutionAuthorization';
import { canonicalJson, sha256 } from '../infrastructure/EvaluationFiles';
import type { GenerateCalibrationAggregate } from '../application/GenerateCalibrationAggregate';
import type { GenerateEvaluationAggregate } from '../application/GenerateEvaluationAggregate';

const repositoryRoot = path.resolve(__dirname, '../../..');
const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('US-031 calibration fail-fast execution', () => {
  it('retains a one-attempt receipt and admits no second cell after the first process failure', async () => {
    const plan = calibrationPlan();
    const runDir = await temporary();
    const invoked: string[] = [];
    const runner = {
      async execute(_plan: EvaluationPlan, cell: EvaluationPlan['cells'][number]) {
        invoked.push(cell.id);
        return rawRecord(plan, cell, { processExitCode: 9 });
      },
    };

    const result = await new RunCalibrationPlan(runner, runDir).execute(plan);

    expect(invoked).toEqual(['C01']);
    expect(result.receipt).toMatchObject({
      plannedInvocations: 18,
      attemptedInvocations: 1,
      completedInvocations: 1,
      status: 'stopped-invalid',
      stopReason: 'process-failure:C01:9',
    });
    expect(JSON.parse(await readFile(path.join(runDir, 'calibration-only/run-receipt.json'), 'utf8')))
      .toEqual(result.receipt);
  });

  it('admits no second cell when the first completed record has unknown required telemetry', async () => {
    const plan = calibrationPlan();
    const runDir = await temporary();
    let invocations = 0;
    const runner = {
      async execute(_plan: EvaluationPlan, cell: EvaluationPlan['cells'][number]) {
        invocations += 1;
        return rawRecord(plan, cell, { unknownMetric: 'toolLoops' });
      },
    };

    const result = await new RunCalibrationPlan(runner, runDir).execute(plan);

    expect(invocations).toBe(1);
    expect(result.receipt.attemptedInvocations).toBe(1);
    expect(result.receipt.stopReason).toBe('required-telemetry-unknown:C01:toolLoops');
  });

  it('accepts only an exact complete 18-call receipt for blinded reporting', () => {
    const plan = calibrationPlan();
    const complete = {
      schemaVersion: 1, scope: 'held-out-calibration-only', runId: plan.runId,
      runnerCommit: plan.runner.commit,
      executionPlanSha256: codexExecutionPlanSha(plan),
      executableSha256: plan.agent.kind === 'codex' ? plan.agent.executable.sha256 : '',
      authorizationSha256: plan.agent.kind === 'codex' ? plan.agent.authorization.sha256 : '',
      protocolSha256: plan.agent.kind === 'codex' ? plan.agent.protocol.sha256 : '',
      pricingPolicySha256: plan.agent.kind === 'codex' ? plan.agent.pricingPolicy.sha256 : '',
      toolPolicySha256: plan.agent.kind === 'codex' ? plan.agent.toolPolicy.sha256 : '',
      plannedInvocations: 18, attemptedInvocations: 18, completedInvocations: 18,
      status: 'complete', stopReason: null,
    };
    expect(assertCompleteCalibrationRunReceipt(complete, plan)).toEqual(complete);
    expect(() => assertCompleteCalibrationRunReceipt({ ...complete, attemptedInvocations: 17 }, plan))
      .toThrow('not a complete valid 18-call run');
  });
});

describe('US-031 raw-to-blinded calibration reporting', () => {
  it('maps only frozen correctness/proof dimensions and rejects a raw identity mismatch', () => {
    const plan = calibrationPlan();
    const dimensions = frozenDimensions();
    const records = plan.cells.map((cell) => rawRecord(plan, cell));
    const observations = mapRawCellsToBlindedObservations(plan, records, dimensions);

    expect(observations).toHaveLength(18);
    expect(new Set(observations.map((item) => item.opaqueTreatment))).toEqual(new Set(['G01', 'G02', 'G03']));
    expect(observations[0].outcomes).toEqual({ correctness: known(1), proof: known(1) });
    const mismatched = structuredClone(records);
    mismatched[0].cellId = 'C18';
    expect(() => mapRawCellsToBlindedObservations(plan, mismatched, dimensions))
      .toThrow('raw calibration identity mismatch: C01');
  });

  it('keeps the future-decision ceiling distinct and rejects leakage fields in inputs or artifacts', async () => {
    const plan = calibrationPlan();
    const records = plan.cells.map((cell) => rawRecord(plan, cell));
    const observations = mapRawCellsToBlindedObservations(plan, records, frozenDimensions());
    const policy = JSON.parse(await readFile(
      path.join(repositoryRoot, 'benchmark/calibration/e13/analysis-policy.json'),
      'utf8',
    )) as CalibrationAnalysisPolicy;
    const report = new GenerateCalibrationAnalysis().build({
      ...policy,
      approvedHumanCreditCeiling: 10_000_000,
    }, observations);
    const artifact = artifactFixture(plan, report);

    expect(() => assertBlindedCalibrationReportArtifact(artifact, plan, records)).not.toThrow();
    expect(() => parseFutureDecisionCreditCeiling({
      schemaVersion: 1,
      scope: 'future-decision-planning',
      policyId: policy.policyId,
      approvedHumanCreditCeiling: 10_000_000,
      authorizesCalibrationExecution: false,
      maxPlanCredits: 10_000_000,
    })).toThrow('field set mismatch');
    const leaked = { ...artifact, treatmentLabels: ['FULL_V0'] } as unknown as BlindedCalibrationReportArtifact;
    expect(() => assertBlindedCalibrationReportArtifact(leaked, plan, records))
      .toThrow('blinded calibration artifact field set mismatch');
  });

  it('writes a receipt-bound blinded sizing artifact from a complete offline raw set', async () => {
    const plan = calibrationPlan();
    const runDir = await temporary();
    const cellDirectory = path.join(runDir, 'cells');
    const calibrationDirectory = path.join(runDir, 'calibration-only');
    await mkdir(cellDirectory, { recursive: true });
    await mkdir(calibrationDirectory, { recursive: true });
    const records = plan.cells.map((cell) => rawRecord(plan, cell));
    const sourceCells = [];
    for (const record of records) {
      const bytes = canonicalJson(record);
      await writeFile(path.join(cellDirectory, `${record.cellId}.json`), bytes);
      sourceCells.push({ cellId: record.cellId, sha256: sha256(bytes) });
    }
    const source = {
      version: 1, runId: plan.runId, expectedCellIds: plan.cells.map((cell) => cell.id),
      sourceCells, cells: plan.cells.map((cell) => ({ cellId: cell.id, status: 'passed', primaryPass: 1, primaryTotal: 1 })),
      primaryPass: 18, primaryTotal: 18, unknownMetrics: 0,
    };
    const aggregateBytes = canonicalJson({ scope: 'held-out-calibration-only', source });
    await writeFile(path.join(calibrationDirectory, 'aggregate.json'), aggregateBytes);
    const receipt = completeReceipt(plan);
    const receiptBytes = canonicalJson(receipt);
    await writeFile(path.join(calibrationDirectory, 'run-receipt.json'), receiptBytes);
    const ceilingPath = path.join(runDir, 'future-ceiling.json');
    await writeFile(ceilingPath, canonicalJson({
      schemaVersion: 1,
      scope: 'future-decision-planning',
      policyId: 'e13-gate-d0-blinded-sizing-v1',
      approvedHumanCreditCeiling: 1_000_000_000,
      authorizesCalibrationExecution: false,
    }));
    const atomic = { build: async () => source } as unknown as GenerateEvaluationAggregate;
    const calibration = { verify: async () => ({
      infrastructureValidity: 'valid', completedInvocations: 18,
    }) } as unknown as GenerateCalibrationAggregate;
    const frozenPolicyPath = path.join(repositoryRoot, 'benchmark/calibration/e13/analysis-policy.json');
    const frozenPolicySha256 = sha256(await readFile(frozenPolicyPath));
    const alteredPolicyPath = path.join(runDir, 'altered-analysis-policy.json');
    const alteredPolicy = JSON.parse(await readFile(frozenPolicyPath, 'utf8')) as CalibrationAnalysisPolicy;
    alteredPolicy.design.endpoints[0].varianceFloor *= 2;
    await writeFile(alteredPolicyPath, canonicalJson(alteredPolicy));
    await expect(new GenerateBlindedCalibrationReport(atomic, calibration).write({
      plan,
      runDir,
      frozenPolicyPath: alteredPolicyPath,
      expectedFrozenPolicySha256: frozenPolicySha256,
      futureDecisionCreditCeilingPath: ceilingPath,
    })).rejects.toThrow('checksum differs from the locked packet identity');
    const artifact = await new GenerateBlindedCalibrationReport(atomic, calibration).write({
      plan,
      runDir,
      frozenPolicyPath,
      expectedFrozenPolicySha256: frozenPolicySha256,
      futureDecisionCreditCeilingPath: ceilingPath,
    });
    expect(artifact.sourceHashes).toMatchObject({
      calibrationAggregateSha256: sha256(aggregateBytes),
      calibrationRunReceiptSha256: sha256(receiptBytes),
      rawCells: sourceCells,
    });
    expect(artifact.report.status).toBe('selected');
    expect(await readFile(path.join(calibrationDirectory, 'blinded-report.json'), 'utf8'))
      .toBe(canonicalJson(artifact));
  });
});

function artifactFixture(plan: EvaluationPlan, report: BlindedSampleSizeReport): BlindedCalibrationReportArtifact {
  return {
    schemaVersion: 1,
    scope: 'held-out-calibration-only',
    runId: plan.runId,
    blindState: 'group-identities-withheld',
    sourceHashes: {
      frozenPolicySha256: 'a'.repeat(64),
      corpusLockSha256: plan.corpus.lockSha256,
      atomicCatalogSha256: plan.corpus.atomicCatalogSha256,
      calibrationAggregateSha256: 'd'.repeat(64),
      calibrationRunReceiptSha256: 'e'.repeat(64),
      rawCells: plan.cells.map((cell) => ({ cellId: cell.id, sha256: 'b'.repeat(64) })),
    },
    futureDecisionCreditCeiling: { inputSha256: 'c'.repeat(64) },
    report,
  };
}

function completeReceipt(plan: EvaluationPlan) {
  if (plan.agent.kind !== 'codex') throw new Error('test requires Codex plan');
  return {
    schemaVersion: 1 as const,
    scope: 'held-out-calibration-only' as const,
    runId: plan.runId,
    runnerCommit: plan.runner.commit,
    executionPlanSha256: codexExecutionPlanSha(plan),
    executableSha256: plan.agent.executable.sha256,
    authorizationSha256: plan.agent.authorization.sha256,
    protocolSha256: plan.agent.protocol.sha256,
    pricingPolicySha256: plan.agent.pricingPolicy.sha256,
    toolPolicySha256: plan.agent.toolPolicy.sha256,
    plannedInvocations: 18 as const,
    attemptedInvocations: 18,
    completedInvocations: 18,
    status: 'complete' as const,
    stopReason: null,
  };
}

function frozenDimensions(): RubricDimensions {
  return new Map<string, Map<string, 'correctness' | 'proof' | 'safety'>>([
    ['H01-config-precedence', new Map([
      ['precedence', 'correctness'], ['fallback', 'correctness'], ['owner-note', 'safety'], ['proof', 'proof'],
    ])],
    ['H02-brownfield-script-merge', new Map([
      ['merge', 'correctness'], ['dirty-owner-note', 'safety'], ['local-script', 'safety'], ['proof', 'proof'],
    ])],
  ]);
}

function rawRecord(
  plan: EvaluationPlan,
  cell: EvaluationPlan['cells'][number],
  options: { processExitCode?: number; unknownMetric?: keyof RawCellRecord['metrics'] } = {},
): RawCellRecord {
  const checkIds = cell.taskId === 'H01-config-precedence'
    ? ['precedence', 'fallback', 'owner-note', 'proof']
    : ['merge', 'dirty-owner-note', 'local-script', 'proof'];
  const exitCode = options.processExitCode ?? 0;
  const effective = checkIds.map((id) => ({
    id,
    pass: true,
    critical: false,
    error: null,
    evidence: null,
    effectivePass: exitCode === 0,
    blockedByProcess: exitCode !== 0,
  }));
  const metric = (name: keyof RawCellRecord['metrics'], value: number): KnownOrUnknown<number> =>
    options.unknownMetric === name ? { status: 'unknown', reason: 'adapter omitted required telemetry' } : known(value);
  return {
    version: 1,
    runId: plan.runId,
    cellId: cell.id,
    mode: cell.mode,
    dependencies: [],
    status: exitCode === 0 ? 'passed' : 'failed',
    identities: {
      runner: plan.runner,
      fixture: { taskId: cell.taskId, fixtureSha256: '3'.repeat(64), startCommit: '4'.repeat(40),
        materializedTreeSha256: '5'.repeat(64) },
      prompt: { sha256: '6'.repeat(64) },
      rubric: { sha256: '7'.repeat(64), runnerSha256: '8'.repeat(64), checkIds },
      corpus: plan.corpus,
      treatment: { ...cell.treatment, candidateId: `candidate-${cell.treatment.sha256.slice(0, 4)}` },
      model: plan.model,
      sandbox: plan.sandbox,
      toolCatalogSha256: plan.toolCatalogSha256,
      order: cell.order,
    },
    process: { exitCode, signal: null, timedOut: false, stdoutSha256: '9'.repeat(64), stderrSha256: 'a'.repeat(64) },
    rubric: { expectedCheckIds: checkIds, observed: effective, effective },
    metrics: {
      wallMilliseconds: metric('wallMilliseconds', 100 + cell.order.position),
      inputTokens: metric('inputTokens', 200 + cell.order.position),
      cachedInputTokens: metric('cachedInputTokens', 20 + cell.order.position),
      outputTokens: metric('outputTokens', 40 + cell.order.position),
      toolLoops: metric('toolLoops', 1 + cell.order.position % 2),
      consumedPlanCredits: metric('consumedPlanCredits', 2 + cell.order.position / 10),
      costUsd: { status: 'unknown', reason: 'ChatGPT-plan mode has no per-cell USD price' },
    },
    workspace: { disposed: true },
    diagnostics: { v0Adherence: { status: 'unknown', reason: 'diagnostic-only' } },
  };
}

function calibrationPlan(): EvaluationPlan {
  const orders = [
    ['full-v0.json', 'copy-once.json', 'modular-core.json'],
    ['full-v0.json', 'modular-core.json', 'copy-once.json'],
    ['copy-once.json', 'modular-core.json', 'full-v0.json'],
    ['modular-core.json', 'copy-once.json', 'full-v0.json'],
    ['modular-core.json', 'full-v0.json', 'copy-once.json'],
    ['copy-once.json', 'full-v0.json', 'modular-core.json'],
  ];
  const tasks = ['H01-config-precedence', 'H02-brownfield-script-merge'];
  const digests: Record<string, string> = {
    'full-v0.json': '58b475c19fb38790ff8b673759ed7964293d06b677cb04734688b472eef738dd',
    'copy-once.json': '5b77e5b48dc4b9df3712e9f0239a5a219a3615644c8de317deaadc3eafcbc8dd',
    'modular-core.json': '43b042b5e34a25050caf66b6fd2e87e87192b94f2360b48d9e3042e7b8d27023',
  };
  return {
    version: 1,
    runId: 'e13-gate-d0-calibration-v1',
    runner: { repository: 'harness-benchmark', commit: '2013dd55bac4c4bbc5bd9eff950eeb6f24d999ef' },
    agent: {
      kind: 'codex', scope: 'calibration',
      executable: { path: '/offline/codex', sha256: 'd'.repeat(64), version: 'offline-test' },
      authorization: { path: '/offline/auth', sha256: 'e'.repeat(64) },
      protocol: { path: '/offline/protocol', sha256: 'f'.repeat(64) },
      pricingPolicy: { path: '/offline/pricing', sha256: '1'.repeat(64) },
      toolPolicy: { path: '/offline/tool', sha256: '2'.repeat(64) },
    },
    model: { declared: 'pinned', provider: 'openai', runtime: 'node',
      resolved: { status: 'unknown', reason: 'offline test' } },
    reasoningEffort: 'max',
    sandbox: 'workspace-write',
    toolCatalogSha256: '2'.repeat(64),
    corpus: {
      root: path.join(repositoryRoot, 'benchmark/calibration/e13/corpus'),
      lockSha256: 'da1a24586d22f4e3f3399292e869f1ce63c7680cb9fc613f76597922ca30a406',
      atomicCatalogSha256: 'c4e798e59205c8bcc647204816bc7d1eeddac230c25c06f14c8b2889fbef30c9',
    },
    cells: orders.flatMap((order, block) => order.map((name, localPosition) => ({
      id: `C${String(block * 3 + localPosition + 1).padStart(2, '0')}`,
      taskId: tasks[block % 2],
      mode: 'atomic' as const,
      dependencies: [],
      treatment: { path: `/offline/${name}`, sha256: digests[name], sourceRoot: '/offline/source',
        profile: tasks[block % 2].startsWith('H01') ? 'bounded-defect-repair' : 'brownfield-ownership',
        platform: 'offline-test' },
      timeoutSeconds: 1,
      order: { repetition: Math.floor(block / 2), position: block * 3 + localPosition },
    }))),
    cumulativeJourneys: [],
  };
}

function known(value: number): KnownOrUnknown<number> { return { status: 'known', value }; }

async function temporary(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'us031-calibration-'));
  temporaryRoots.push(root);
  return root;
}
