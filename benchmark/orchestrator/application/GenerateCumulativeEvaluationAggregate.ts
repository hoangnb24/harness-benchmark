import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type {
  CumulativeJourneyRecord,
  CumulativeJourneySpec,
  EvaluationPlan,
  KnownOrUnknown,
} from '../domain/evaluation';
import { effectiveRubricResults } from '../domain/evaluation';

export interface CumulativeEvaluationAggregate {
  version: 1;
  runId: string;
  separateAnalysis: true;
  excludedFromAtomicPrimaryAggregate: true;
  expectedJourneyRunIds: string[];
  sourceJourneys: Array<{ journeyRunId: string; sha256: string }>;
  journeyCount: number;
  stepPass: number;
  stepTotal: number;
  journeys: Array<{ journeyRunId: string; statuses: string[] }>;
}

interface CatalogJourney {
  id: string;
  fixture: unknown;
  steps: Array<{
    id: string;
    dependsOn: string[];
    prompt: string;
    rubric: { denominator: number; checks: Array<{ id: string }> };
  }>;
}

interface FrozenJourney {
  id: string;
  fixtureSha256: string;
  startCommit: string;
  steps: Array<{ id: string; promptSha256: string; rubricSha256: string }>;
}

export class GenerateCumulativeEvaluationAggregate {
  async build(plan: EvaluationPlan, runDir: string): Promise<CumulativeEvaluationAggregate> {
    const journeyDir = path.join(runDir, 'cumulative', 'journeys');
    const expectedFiles = plan.cumulativeJourneys.map((journey) => `${safe(journey.id)}.json`).sort();
    const actualFiles = (await readdir(journeyDir)).sort();
    if (actualFiles.join('\0') !== expectedFiles.join('\0')) {
      throw new Error(`cumulative raw journey set mismatch: expected [${expectedFiles}], got [${actualFiles}]`);
    }
    const catalog = await loadCatalog(plan);
    const records: CumulativeJourneyRecord[] = [];
    const sourceJourneys: CumulativeEvaluationAggregate['sourceJourneys'] = [];
    for (const spec of plan.cumulativeJourneys) {
      const rawPath = path.join(journeyDir, `${safe(spec.id)}.json`);
      const details = await lstat(rawPath);
      if (!details.isFile() || details.isSymbolicLink()) {
        throw new Error(`cumulative raw journey is not a regular file: ${spec.id}`);
      }
      const bytes = await readFile(rawPath);
      const record = JSON.parse(bytes.toString('utf8')) as CumulativeJourneyRecord;
      const frozen = catalog.find((item) => item.journey.id === spec.journeyId);
      if (!frozen) throw new Error(`cumulative catalog journey is missing: ${spec.journeyId}`);
      await validateRecord(record, plan, spec, frozen.journey, frozen.lock, runDir);
      records.push(record);
      sourceJourneys.push({ journeyRunId: spec.id, sha256: sha256(bytes) });
    }
    return {
      version: 1,
      runId: plan.runId,
      separateAnalysis: true,
      excludedFromAtomicPrimaryAggregate: true,
      expectedJourneyRunIds: plan.cumulativeJourneys.map((journey) => journey.id),
      sourceJourneys,
      journeyCount: records.length,
      stepPass: records.flatMap((record) => record.steps).filter((step) => step.status === 'passed').length,
      stepTotal: records.flatMap((record) => record.steps).length,
      journeys: records.map((record) => ({
        journeyRunId: record.journeyRunId,
        statuses: record.steps.map((step) => step.status),
      })),
    };
  }

  async write(plan: EvaluationPlan, runDir: string): Promise<CumulativeEvaluationAggregate> {
    const aggregate = await this.build(plan, runDir);
    const output = path.join(runDir, 'cumulative', 'aggregate.json');
    await mkdir(path.dirname(output), { recursive: true });
    await writeFile(output, canonicalJson(aggregate), { flag: 'wx' });
    return aggregate;
  }

  async verify(plan: EvaluationPlan, runDir: string): Promise<CumulativeEvaluationAggregate> {
    const output = path.join(runDir, 'cumulative', 'aggregate.json');
    const details = await lstat(output);
    if (!details.isFile() || details.isSymbolicLink()) {
      throw new Error('cumulative aggregate is not a regular file');
    }
    const actual = await readFile(output, 'utf8');
    const expected = await this.build(plan, runDir);
    if (actual !== canonicalJson(expected)) {
      throw new Error('cumulative aggregate content does not match raw journey records');
    }
    return expected;
  }
}

async function loadCatalog(plan: EvaluationPlan): Promise<Array<{ journey: CatalogJourney; lock: FrozenJourney }>> {
  if (!plan.corpus.cumulativeCatalogSha256) throw new Error('cumulative catalog identity is required');
  const catalogPath = path.join(plan.corpus.root, 'cumulative-catalog.json');
  const details = await lstat(catalogPath);
  if (!details.isFile() || details.isSymbolicLink()) throw new Error('cumulative catalog is not a regular file');
  const catalog = JSON.parse(await readFile(catalogPath, 'utf8')) as { journeys?: CatalogJourney[] };
  if (!Array.isArray(catalog.journeys) || sha256(compactCanonical(catalog)) !== plan.corpus.cumulativeCatalogSha256) {
    throw new Error('cumulative catalog identity mismatch during aggregation');
  }
  const lockPath = path.join(plan.corpus.root, 'corpus-lock.json');
  const lockDetails = await lstat(lockPath);
  if (!lockDetails.isFile() || lockDetails.isSymbolicLink()) throw new Error('corpus lock is not a regular file');
  const lockBytes = await readFile(lockPath);
  if (sha256(lockBytes) !== plan.corpus.lockSha256) throw new Error('corpus lock checksum mismatch during aggregation');
  const lock = JSON.parse(lockBytes.toString('utf8')) as {
    cumulativeCatalogSha256?: string;
    cumulativeJourneys?: FrozenJourney[];
  };
  if (lock.cumulativeCatalogSha256 !== plan.corpus.cumulativeCatalogSha256 || !Array.isArray(lock.cumulativeJourneys)) {
    throw new Error('corpus lock cumulative identity mismatch during aggregation');
  }
  return catalog.journeys.map((journey) => {
    const frozen = lock.cumulativeJourneys?.find((item) => item.id === journey.id);
    if (!frozen) throw new Error(`cumulative lock journey is missing: ${journey.id}`);
    if (sha256(compactCanonical(journey.fixture)) !== frozen.fixtureSha256) {
      throw new Error(`cumulative locked fixture mismatch: ${journey.id}`);
    }
    for (const step of journey.steps) {
      const lockedStep = frozen.steps.find((item) => item.id === step.id);
      if (
        !lockedStep ||
        sha256(step.prompt) !== lockedStep.promptSha256 ||
        sha256(compactCanonical(step.rubric)) !== lockedStep.rubricSha256
      ) {
        throw new Error(`cumulative locked step mismatch: ${step.id}`);
      }
    }
    return { journey, lock: frozen };
  });
}

async function validateRecord(
  record: CumulativeJourneyRecord,
  plan: EvaluationPlan,
  spec: CumulativeJourneySpec,
  journey: CatalogJourney,
  frozen: FrozenJourney,
  runDir: string,
): Promise<void> {
  if (
    record.version !== 1 ||
    record.runId !== plan.runId ||
    record.journeyRunId !== spec.id ||
    record.catalogJourneyId !== spec.journeyId ||
    record.excludedFromAtomicScores !== true ||
    record.treatmentApplicationCount !== 1 ||
    record.workspace?.disposed !== true
  ) {
    throw new Error(`cumulative journey plan identity mismatch: ${spec.id}`);
  }
  if (
    record.identities.fixture.fixtureSha256 !== frozen.fixtureSha256 ||
    record.identities.fixture.startCommit !== frozen.startCommit
  ) {
    throw new Error(`cumulative fixture identity mismatch: ${spec.id}`);
  }
  same(record.identities.runner, plan.runner, `cumulative runner identity ${spec.id}`);
  same(record.identities.agent, plan.agent, `cumulative agent identity ${spec.id}`);
  same(record.identities.model, plan.model, `cumulative model identity ${spec.id}`);
  same(record.identities.order, spec.order, `cumulative order identity ${spec.id}`);
  if (
    record.identities.reasoningEffort !== plan.reasoningEffort ||
    record.identities.sandbox !== plan.sandbox ||
    record.identities.toolCatalogSha256 !== plan.toolCatalogSha256
  ) {
    throw new Error(`cumulative execution identity mismatch: ${spec.id}`);
  }
  const treatmentEvidencePath = path.join(
    runDir,
    'cumulative',
    'evidence',
    safe(spec.id),
    'treatment-application-receipt.json',
  );
  const treatmentEvidenceDetails = await lstat(treatmentEvidencePath);
  if (!treatmentEvidenceDetails.isFile() || treatmentEvidenceDetails.isSymbolicLink()) {
    throw new Error(`cumulative treatment evidence is not a regular file: ${spec.id}`);
  }
  same(
    JSON.parse(await readFile(treatmentEvidencePath, 'utf8')),
    record.treatmentApplication,
    `cumulative retained treatment receipt ${spec.id}`,
  );
  for (const key of ['path', 'sha256', 'sourceRoot', 'profile', 'platform', 'artifactCache'] as const) {
    if (record.identities.treatment[key] !== spec.treatment[key]) {
      throw new Error(`cumulative treatment identity mismatch ${key}: ${spec.id}`);
    }
  }
  if (
    record.treatmentApplication.candidateId !== record.identities.treatment.candidateId ||
    record.treatmentApplication.manifestSha256 !== spec.treatment.sha256 ||
    record.treatmentApplication.activationProfile !== spec.treatment.profile ||
    record.treatmentApplication.platform !== spec.treatment.platform ||
    record.treatmentApplication.stagedTreeSha256 !== record.identities.treatment.stagedTreeSha256 ||
    record.treatmentApplication.resultingTreeSha256 !== record.identities.treatment.appliedTreeSha256 ||
    !/^[a-f0-9]{64}$/.test(record.identities.treatment.appliedWorkspaceSha256) ||
    record.treatmentApplication.visibleInstructionProof?.allDeclaredInstructionsVisible !== true ||
    !Array.isArray(record.treatmentApplication.files) ||
    record.treatmentApplication.files.length === 0
  ) {
    throw new Error(`cumulative treatment receipt mismatch: ${spec.id}`);
  }
  for (const name of [
    'applicationPolicySha256', 'materializationReceiptSha256', 'originalTreeSha256',
    'stagedTreeSha256', 'resultingTreeSha256',
  ] as const) {
    if (!/^[a-f0-9]{64}$/.test(record.treatmentApplication[name])) {
      throw new Error(`cumulative treatment ${name} is not a SHA-256: ${spec.id}`);
    }
  }
  if (record.steps.map((step) => step.stepId).join('\0') !== journey.steps.map((step) => step.id).join('\0')) {
    throw new Error(`cumulative step set or order mismatch: ${spec.id}`);
  }
  const prior = new Map<string, string>();
  let priorAfterSha256: string | undefined;
  for (let index = 0; index < journey.steps.length; index += 1) {
    const expected = journey.steps[index];
    const step = record.steps[index];
    const checkIds = expected.rubric.checks.map((check) => check.id);
    if (
      expected.rubric.denominator !== checkIds.length ||
      step.dependencies.join('\0') !== expected.dependsOn.join('\0') ||
      step.rubric.expectedCheckIds.join('\0') !== checkIds.join('\0')
    ) {
      throw new Error(`cumulative step frozen identity mismatch: ${step.stepId}`);
    }
    const blockedBy = expected.dependsOn.filter((dependency) => prior.get(dependency) !== 'passed');
    if (blockedBy.length > 0) {
      const emptySha256 = sha256(Buffer.from(''));
      const reason = `blocked by dependency: ${blockedBy.join(', ')}`;
      const expectedEffective = checkIds.map((id) => ({
        id,
        pass: false,
        critical: false,
        error: reason,
        evidence: null,
        effectivePass: false,
        blockedByProcess: true,
      }));
      if (
        step.status !== 'blocked_dependency' ||
        step.blockedBy?.join('\0') !== blockedBy.join('\0') ||
        step.process.exitCode !== null ||
        step.process.signal !== null ||
        step.process.timedOut !== false ||
        step.process.stdoutSha256 !== emptySha256 ||
        step.process.stderrSha256 !== emptySha256 ||
        Object.keys(step.evidence).length !== 0 ||
        Object.keys(step.workspace).length !== 0 ||
        step.rubric.observed.length !== 0 ||
        Object.values(step.metrics).some((metric) => metric.status !== 'unknown')
      ) {
        throw new Error(`cumulative blocked-step evidence mismatch: ${step.stepId}`);
      }
      same(step.rubric.effective, expectedEffective, `cumulative blocked rubric ${step.stepId}`);
    } else {
      if (!Number.isInteger(step.process.exitCode)) throw new Error(`cumulative process exit is missing: ${step.stepId}`);
      if (step.process.timedOut && step.process.exitCode !== 124) {
        throw new Error(`cumulative timeout exit mismatch: ${step.stepId}`);
      }
      if (step.process.signal !== null &&
          (typeof step.process.signal !== 'string' || !/^SIG[A-Z0-9]+$/.test(step.process.signal))) {
        throw new Error(`cumulative process signal mismatch: ${step.stepId}`);
      }
      if (
        step.rubric.effective.map((result) => result.id).join('\0') !== checkIds.join('\0') ||
        step.rubric.observed.map((result) => result.id).join('\0') !== checkIds.join('\0')
      ) {
        throw new Error(`cumulative rubric result set mismatch: ${step.stepId}`);
      }
      const expectedEffective = effectiveRubricResults(
        checkIds,
        step.rubric.observed,
        step.process.exitCode as number,
      );
      same(step.rubric.effective, expectedEffective, `cumulative effective rubric ${step.stepId}`);
      const expectedStatus = step.process.exitCode === 0 && expectedEffective.every((result) => result.effectivePass)
        ? 'passed'
        : 'failed';
      if (step.status !== expectedStatus) throw new Error(`cumulative status mismatch: ${step.stepId}`);
      if (!step.workspace.beforeSha256 || !step.workspace.afterSha256) {
        throw new Error(`cumulative workspace identity is missing: ${step.stepId}`);
      }
      const expectedBeforeSha256 = priorAfterSha256 ?? record.identities.treatment.appliedWorkspaceSha256;
      if (step.workspace.beforeSha256 !== expectedBeforeSha256) {
        throw new Error(`cumulative workspace chain mismatch: ${step.stepId}`);
      }
      const evidenceBytes = await validateEvidence(runDir, spec.id, step.stepId, step.evidence);
      if (
        sha256(evidenceBytes.stdoutJsonl) !== step.process.stdoutSha256 ||
        sha256(evidenceBytes.stderr) !== step.process.stderrSha256
      ) {
        throw new Error(`cumulative process evidence hash mismatch: ${step.stepId}`);
      }
      const score = JSON.parse(evidenceBytes.scoreReceipt.toString('utf8')) as {
        schemaVersion?: number; journeyId?: string; stepId?: string; denominator?: number; results?: unknown;
      };
      if (
        score.schemaVersion !== 1 || score.journeyId !== journey.id || score.stepId !== step.stepId ||
        score.denominator !== checkIds.length
      ) {
        throw new Error(`cumulative score receipt identity mismatch: ${step.stepId}`);
      }
      same(score.results, step.rubric.observed, `cumulative retained score ${step.stepId}`);
      const metricsReceipt = JSON.parse(evidenceBytes.metricsReceipt.toString('utf8')) as {
        schemaVersion?: number;
        source?: string;
        emitted?: boolean;
        pricingPolicySha256?: string;
        toolPolicySha256?: string;
        policyViolation?: unknown;
        preflight?: Record<string, unknown>;
        values?: Record<string, unknown> | null;
        measurements?: Record<string, unknown>;
      };
      if (metricsReceipt.schemaVersion !== 1 || typeof metricsReceipt.emitted !== 'boolean') {
        throw new Error(`cumulative metrics receipt is malformed: ${step.stepId}`);
      }
      const expectedMetricsSource = plan.agent.kind === 'codex' ? 'codex-jsonl' : 'fake-metrics-file';
      if (metricsReceipt.source !== expectedMetricsSource) {
        throw new Error(`cumulative metrics receipt source mismatch: ${step.stepId}`);
      }
      for (const name of [
        'inputTokens', 'cachedInputTokens', 'outputTokens', 'toolLoops', 'consumedPlanCredits', 'costUsd',
      ] as const) {
        same(metricsReceipt.measurements?.[name], step.metrics[name], `cumulative retained metric ${name} ${step.stepId}`);
        const emitted = metricsReceipt.values?.[name];
        if (typeof emitted === 'number' && Number.isFinite(emitted)) {
          if (step.metrics[name].status !== 'known' || step.metrics[name].value !== emitted) {
            throw new Error(`cumulative known metric differs from receipt: ${name} ${step.stepId}`);
          }
        } else if (step.metrics[name].status !== 'unknown') {
          throw new Error(`cumulative missing metric became known: ${name} ${step.stepId}`);
        }
      }
      if (metricsReceipt.source === 'codex-jsonl') {
        if (
          plan.agent.kind !== 'codex' ||
          metricsReceipt.pricingPolicySha256 !== plan.agent.pricingPolicy.sha256 ||
          metricsReceipt.toolPolicySha256 !== plan.agent.toolPolicy.sha256
        ) {
          throw new Error(`cumulative Codex policy identity mismatch: ${step.stepId}`);
        }
        validateCodexPreflight(metricsReceipt.preflight, plan, step.stepId);
        if (metricsReceipt.policyViolation !== null && step.process.exitCode !== 126) {
          throw new Error(`cumulative Codex tool-policy violation status mismatch: ${step.stepId}`);
        }
        await validatePlanCredits(step.metrics, plan, step.stepId);
      }
      priorAfterSha256 = step.workspace.afterSha256;
    }
    validateMetrics(step.metrics, step.stepId);
    prior.set(step.stepId, step.status);
  }
}

function validateCodexPreflight(
  value: Record<string, unknown> | undefined,
  plan: EvaluationPlan,
  stepId: string,
): void {
  const version = value?.version as Record<string, unknown> | undefined;
  const authentication = value?.authentication as Record<string, unknown> | undefined;
  const versionStdout = typeof version?.stdout === 'string' ? version.stdout : '';
  const versionStderr = typeof version?.stderr === 'string' ? version.stderr : '';
  const authStdout = typeof authentication?.stdout === 'string' ? authentication.stdout : '';
  const authStderr = typeof authentication?.stderr === 'string' ? authentication.stderr : '';
  if (
    plan.agent.kind !== 'codex' ||
    Object.keys(value ?? {}).sort().join('\0') !== ['authentication', 'version'].join('\0') ||
    version?.observed !== plan.agent.executable.version ||
    versionStdout.trim() !== `codex-cli ${plan.agent.executable.version}` ||
    versionStderr !== '' ||
    version?.stdoutSha256 !== sha256(versionStdout) ||
    version?.stderrSha256 !== sha256(versionStderr) ||
    authentication?.mode !== 'chatgpt' ||
    authStdout.trim() !== 'Logged in using ChatGPT' ||
    authStderr !== '' ||
    authentication?.stdoutSha256 !== sha256(authStdout) ||
    authentication?.stderrSha256 !== sha256(authStderr)
  ) {
    throw new Error(`cumulative Codex preflight receipt mismatch: ${stepId}`);
  }
}

async function validatePlanCredits(
  metrics: CumulativeJourneyRecord['steps'][number]['metrics'],
  plan: EvaluationPlan,
  stepId: string,
): Promise<void> {
  if (plan.agent.kind !== 'codex') throw new Error('cumulative Codex pricing policy is unavailable');
  const pricingBytes = await readFile(plan.agent.pricingPolicy.path);
  if (sha256(pricingBytes) !== plan.agent.pricingPolicy.sha256) {
    throw new Error(`cumulative pricing policy checksum mismatch: ${stepId}`);
  }
  const pricing = JSON.parse(pricingBytes.toString('utf8')) as {
    model?: unknown;
    rates?: { input?: unknown; cachedInput?: unknown; output?: unknown };
  };
  const rates = pricing.rates;
  if (
    pricing.model !== plan.model.declared || !rates ||
    !validRate(rates.input) || !validRate(rates.cachedInput) || !validRate(rates.output) ||
    rates.cachedInput > rates.input
  ) {
    throw new Error(`cumulative pricing policy is invalid: ${stepId}`);
  }
  const { inputTokens, cachedInputTokens, outputTokens, consumedPlanCredits } = metrics;
  if (
    inputTokens.status === 'known' && cachedInputTokens.status === 'known' && outputTokens.status === 'known'
  ) {
    const expected = (
      ((inputTokens.value - cachedInputTokens.value) * rates.input) +
      (cachedInputTokens.value * rates.cachedInput) +
      (outputTokens.value * rates.output)
    ) / 1_000_000;
    if (consumedPlanCredits.status !== 'known' || consumedPlanCredits.value !== expected) {
      throw new Error(`cumulative plan-credit recomputation mismatch: ${stepId}`);
    }
  } else if (consumedPlanCredits.status !== 'unknown') {
    throw new Error(`cumulative plan credits known without token tuple: ${stepId}`);
  }
}

function validRate(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

async function validateEvidence(
  runDir: string,
  journeyRunId: string,
  stepId: string,
  evidence: CumulativeJourneyRecord['steps'][number]['evidence'],
): Promise<Record<'stdoutJsonl' | 'stderr' | 'metricsReceipt' | 'scoreReceipt', Buffer>> {
  const root = path.posix.join('cumulative', 'evidence', safe(journeyRunId), safe(stepId));
  const expected = {
    stdoutJsonl: path.posix.join(root, 'stdout.jsonl'),
    stderr: path.posix.join(root, 'stderr.bin'),
    metricsReceipt: path.posix.join(root, 'metrics-receipt.json'),
    scoreReceipt: path.posix.join(root, 'score-receipt.json'),
  };
  const retained = {} as Record<keyof typeof expected, Buffer>;
  for (const name of Object.keys(expected) as Array<keyof typeof expected>) {
    const ref = evidence[name];
    if (!ref || ref.path !== expected[name]) throw new Error(`cumulative evidence path mismatch: ${stepId} ${name}`);
    const details = await lstat(path.join(runDir, ref.path));
    if (!details.isFile() || details.isSymbolicLink()) throw new Error(`cumulative evidence is not a regular file: ${ref.path}`);
    const bytes = await readFile(path.join(runDir, ref.path));
    if (sha256(bytes) !== ref.sha256) {
      throw new Error(`cumulative evidence checksum mismatch: ${ref.path}`);
    }
    retained[name] = bytes;
  }
  return retained;
}

function validateMetrics(metrics: CumulativeJourneyRecord['steps'][number]['metrics'], stepId: string): void {
  const expected = [
    'cachedInputTokens', 'consumedPlanCredits', 'costUsd', 'inputTokens',
    'outputTokens', 'toolLoops', 'wallMilliseconds',
  ].sort();
  if (Object.keys(metrics).sort().join('\0') !== expected.join('\0')) {
    throw new Error(`cumulative metric set mismatch: ${stepId}`);
  }
  for (const metric of Object.values(metrics) as KnownOrUnknown<number>[]) {
    if (metric.status === 'known') {
      if (!Number.isFinite(metric.value) || metric.value < 0) throw new Error(`invalid cumulative metric: ${stepId}`);
    } else if (!metric.reason) {
      throw new Error(`invalid cumulative unknown metric: ${stepId}`);
    }
  }
  if (
    metrics.inputTokens.status === 'known' &&
    metrics.cachedInputTokens.status === 'known' &&
    metrics.cachedInputTokens.value > metrics.inputTokens.value
  ) {
    throw new Error(`cumulative cached input exceeds input: ${stepId}`);
  }
}

function safe(value: string): string {
  if (!/^[A-Za-z0-9._-]+$/.test(value)) throw new Error(`unsafe cumulative id: ${value}`);
  return value;
}

function same(actual: unknown, expected: unknown, label: string): void {
  if (canonicalJson(actual) !== canonicalJson(expected)) throw new Error(`${label} mismatch`);
}

function compactCanonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(compactCanonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value as Record<string, unknown>).sort().map((key) =>
      `${JSON.stringify(key)}:${compactCanonical((value as Record<string, unknown>)[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
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
