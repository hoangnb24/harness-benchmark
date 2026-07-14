import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import {
  effectiveRubricResults,
  type CumulativeJourneyRecord,
  type CumulativeJourneySpec,
  type CumulativeStepRecord,
  type EvaluationCellSpec,
  type EvaluationPlan,
  type ObservedRubricResult,
} from '../domain/evaluation';
import type { CumulativeJourneyExecutor } from '../ports/CumulativeJourneyExecutor';
import type { EvaluationCellExecutor } from '../ports/EvaluationCellExecutor';
import type { EvaluationTreatmentMaterializer } from '../ports/EvaluationTreatmentMaterializer';
import { canonicalJson, sha256, sha256File, treeSha256 } from './EvaluationFiles';

const execFileAsync = promisify(execFile);

interface CatalogCheck {
  id: string;
  kind: 'contains';
  scope: 'workspace' | 'submission';
  path: string;
  values: string[];
}

interface CatalogStep {
  id: string;
  dependsOn: string[];
  prompt: string;
  rubric: { denominator: number; checks: CatalogCheck[] };
}

interface CatalogJourney {
  id: string;
  taskClass: string;
  atomic: false;
  excludedFromAtomicScores: true;
  fixture: { seedId: string; lineage: string; files: Record<string, string> };
  steps: CatalogStep[];
}

export class Phase0CumulativeJourneyExecutor implements CumulativeJourneyExecutor {
  constructor(
    private readonly treatment: EvaluationTreatmentMaterializer,
    private readonly agent: EvaluationCellExecutor,
    private readonly runDir: string,
  ) {}

  async preflight(plan: EvaluationPlan, spec: CumulativeJourneySpec): Promise<number> {
    const { journey, frozen } = await loadJourney(plan, spec);
    const rootDir = await mkdtemp(path.join(tmpdir(), `harness-cumulative-preflight-${safe(spec.id)}-`));
    const workspaceDir = path.join(rootDir, 'workspace');
    try {
      await mkdir(workspaceDir, { recursive: true });
      await writeFileMap(workspaceDir, journey.fixture.files);
      const startCommit = await initializeStartCommit(workspaceDir, journey.fixture.seedId);
      if (startCommit !== frozen.startCommit) {
        throw new Error(`cumulative preflight start commit mismatch: ${spec.id}`);
      }
      await this.treatment.materializeAndApply(
        journeyCell(spec, journey.id, `${spec.id}-treatment-preflight`),
        workspaceDir,
        rootDir,
      );
      return journey.steps.length;
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  }

  async execute(plan: EvaluationPlan, spec: CumulativeJourneySpec): Promise<CumulativeJourneyRecord> {
    const { journey, frozen } = await loadJourney(plan, spec);
    const rootDir = await mkdtemp(path.join(tmpdir(), `harness-cumulative-${safe(spec.id)}-`));
    const workspaceDir = path.join(rootDir, 'workspace');
    const submissionRoot = path.join(rootDir, 'submissions');
    let record: CumulativeJourneyRecord | undefined;
    try {
      await mkdir(workspaceDir, { recursive: true });
      await writeFileMap(workspaceDir, journey.fixture.files);
      const startCommit = await initializeStartCommit(workspaceDir, journey.fixture.seedId);
      if (startCommit !== frozen.startCommit) {
        throw new Error(`cumulative journey start commit mismatch: ${spec.id}`);
      }
      const treatmentCell = journeyCell(spec, journey.id, `${spec.id}-treatment`);
      const materialized = await this.treatment.materializeAndApply(treatmentCell, workspaceDir, rootDir);
      const steps: CumulativeStepRecord[] = [];
      const byId = new Map<string, CumulativeStepRecord>();
      for (const step of journey.steps) {
        const blockedBy = step.dependsOn.filter((dependency) => byId.get(dependency)?.status !== 'passed');
        if (blockedBy.length > 0) {
          const blocked = blockedStep(step, blockedBy);
          steps.push(blocked);
          byId.set(step.id, blocked);
          continue;
        }
        const submissionDir = path.join(submissionRoot, safe(step.id));
        await mkdir(submissionDir, { recursive: true });
        const beforeSha256 = await treeSha256(workspaceDir, true);
        const process = await this.agent.execute({
          cell: journeyCell(spec, step.id, step.id),
          workspaceDir,
          submissionDir,
          prompt: step.prompt,
        });
        const observed = await evaluate(step, workspaceDir, submissionDir);
        const checkIds = step.rubric.checks.map((check) => check.id);
        const effective = effectiveRubricResults(checkIds, observed, process.exitCode);
        const status = process.exitCode === 0 && effective.every((result) => result.effectivePass)
          ? 'passed'
          : 'failed';
        const evidenceRoot = path.posix.join('cumulative', 'evidence', safe(spec.id), safe(step.id));
        const scoreBytes = Buffer.from(canonicalJson({
          schemaVersion: 1,
          journeyId: journey.id,
          stepId: step.id,
          denominator: checkIds.length,
          results: observed,
        }));
        const evidence = {
          stdoutJsonl: await retain(this.runDir, path.posix.join(evidenceRoot, 'stdout.jsonl'), process.stdout),
          stderr: await retain(this.runDir, path.posix.join(evidenceRoot, 'stderr.bin'), process.stderr),
          metricsReceipt: await retain(
            this.runDir,
            path.posix.join(evidenceRoot, 'metrics-receipt.json'),
            process.metricsReceipt,
          ),
          scoreReceipt: await retain(this.runDir, path.posix.join(evidenceRoot, 'score-receipt.json'), scoreBytes),
        };
        const result: CumulativeStepRecord = {
          stepId: step.id,
          dependencies: [...step.dependsOn],
          status,
          process: {
            exitCode: process.exitCode,
            signal: process.signal ?? null,
            timedOut: process.timedOut,
            stdoutSha256: sha256(process.stdout),
            stderrSha256: sha256(process.stderr),
          },
          evidence,
          rubric: { expectedCheckIds: checkIds, observed, effective },
          metrics: {
            wallMilliseconds: { status: 'known', value: process.wallMilliseconds },
            inputTokens: process.inputTokens,
            cachedInputTokens: process.cachedInputTokens ?? unknown('cached input telemetry was not provided by the adapter'),
            outputTokens: process.outputTokens,
            toolLoops: process.toolLoops ?? unknown('tool-loop telemetry was not provided by the adapter'),
            consumedPlanCredits: process.consumedPlanCredits ?? unknown('plan-credit telemetry was not provided by the adapter'),
            costUsd: process.costUsd,
          },
          workspace: { beforeSha256, afterSha256: await treeSha256(workspaceDir, true) },
        };
        steps.push(result);
        byId.set(step.id, result);
      }
      await retain(
        this.runDir,
        path.posix.join('cumulative', 'evidence', safe(spec.id), 'treatment-application-receipt.json'),
        materialized.receiptBytes,
      );
      record = {
        version: 1,
        runId: plan.runId,
        journeyRunId: spec.id,
        catalogJourneyId: journey.id,
        excludedFromAtomicScores: true,
        identities: {
          runner: plan.runner,
          fixture: { fixtureSha256: frozen.fixtureSha256, startCommit },
          treatment: {
            ...spec.treatment,
            candidateId: materialized.receipt.candidateId,
            stagedTreeSha256: materialized.receipt.stagedTreeSha256,
            appliedTreeSha256: materialized.receipt.resultingTreeSha256,
            appliedWorkspaceSha256: materialized.appliedWorkspaceSha256,
          },
          agent: plan.agent,
          model: plan.model,
          reasoningEffort: plan.reasoningEffort,
          sandbox: plan.sandbox,
          toolCatalogSha256: plan.toolCatalogSha256,
          order: spec.order,
        },
        treatmentApplication: materialized.receipt,
        treatmentApplicationCount: 1,
        steps,
        workspace: { disposed: false },
      };
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
    if (!record) throw new Error(`cumulative journey did not produce a record: ${spec.id}`);
    record.workspace.disposed = true;
    const recordPath = path.join(this.runDir, 'cumulative', 'journeys', `${safe(spec.id)}.json`);
    await mkdir(path.dirname(recordPath), { recursive: true });
    await writeFile(recordPath, canonicalJson(record), { flag: 'wx' });
    return record;
  }
}

async function loadJourney(plan: EvaluationPlan, spec: CumulativeJourneySpec): Promise<{
  journey: CatalogJourney;
  frozen: { fixtureSha256: string; startCommit: string; steps: Array<{ id: string; promptSha256: string; rubricSha256: string }> };
}> {
  if (!plan.corpus.cumulativeCatalogSha256) throw new Error('cumulative catalog identity is required');
  const lockPath = path.join(plan.corpus.root, 'corpus-lock.json');
  if ((await sha256File(lockPath)) !== plan.corpus.lockSha256) throw new Error('corpus lock checksum mismatch');
  const catalog = JSON.parse(await readFile(path.join(plan.corpus.root, 'cumulative-catalog.json'), 'utf8')) as {
    journeys: CatalogJourney[];
  };
  if (sha256(compactCanonical(catalog)) !== plan.corpus.cumulativeCatalogSha256) {
    throw new Error('cumulative catalog semantic checksum mismatch');
  }
  const lock = JSON.parse(await readFile(lockPath, 'utf8')) as {
    cumulativeCatalogSha256: string;
    cumulativeJourneys: Array<{
      id: string;
      fixtureSha256: string;
      startCommit: string;
      steps: Array<{ id: string; promptSha256: string; rubricSha256: string }>;
    }>;
  };
  if (lock.cumulativeCatalogSha256 !== plan.corpus.cumulativeCatalogSha256) {
    throw new Error('corpus lock does not identify the cumulative catalog');
  }
  const journey = catalog.journeys.find((item) => item.id === spec.journeyId);
  const frozen = lock.cumulativeJourneys.find((item) => item.id === spec.journeyId);
  if (!journey || !frozen || journey.atomic !== false || journey.excludedFromAtomicScores !== true) {
    throw new Error(`missing or invalid frozen cumulative journey: ${spec.journeyId}`);
  }
  if (journey.taskClass !== spec.treatment.profile) {
    throw new Error(`cumulative treatment profile mismatch: ${spec.id}`);
  }
  if (sha256(compactCanonical(journey.fixture)) !== frozen.fixtureSha256) {
    throw new Error(`cumulative fixture checksum mismatch: ${spec.id}`);
  }
  const seen = new Set<string>();
  for (const step of journey.steps) {
    const locked = frozen.steps.find((item) => item.id === step.id);
    if (!locked || sha256(step.prompt) !== locked.promptSha256 || sha256(compactCanonical(step.rubric)) !== locked.rubricSha256) {
      throw new Error(`cumulative step identity mismatch: ${step.id}`);
    }
    if (step.rubric.denominator !== step.rubric.checks.length || step.rubric.checks.length === 0) {
      throw new Error(`cumulative step denominator is invalid: ${step.id}`);
    }
    if (step.dependsOn.some((dependency) => !seen.has(dependency))) {
      throw new Error(`cumulative step dependency order is invalid: ${step.id}`);
    }
    seen.add(step.id);
  }
  return { journey, frozen };
}

function journeyCell(spec: CumulativeJourneySpec, taskId: string, id: string): EvaluationCellSpec {
  return {
    id,
    taskId,
    mode: 'cumulative',
    dependencies: [],
    treatment: spec.treatment,
    timeoutSeconds: spec.timeoutSeconds,
    order: spec.order,
  };
}

async function evaluate(
  step: CatalogStep,
  workspaceDir: string,
  submissionDir: string,
): Promise<ObservedRubricResult[]> {
  return Promise.all(step.rubric.checks.map(async (check) => {
    let pass = false;
    let error: string | null = null;
    try {
      const root = check.scope === 'workspace' ? workspaceDir : submissionDir;
      const contents = await readFile(path.join(root, safeRelative(check.path)), 'utf8');
      pass = check.values.every((value) => contents.includes(value));
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    }
    return { id: check.id, pass, critical: false, error, evidence: null };
  }));
}

function blockedStep(step: CatalogStep, blockedBy: string[]): CumulativeStepRecord {
  const reason = `blocked by dependency: ${blockedBy.join(', ')}`;
  return {
    stepId: step.id,
    dependencies: [...step.dependsOn],
    status: 'blocked_dependency',
    blockedBy,
    process: {
      exitCode: null,
      signal: null,
      timedOut: false,
      stdoutSha256: sha256(''),
      stderrSha256: sha256(''),
    },
    evidence: {},
    rubric: {
      expectedCheckIds: step.rubric.checks.map((check) => check.id),
      observed: [],
      effective: step.rubric.checks.map((check) => ({
        id: check.id,
        pass: false,
        critical: false,
        error: reason,
        evidence: null,
        effectivePass: false,
        blockedByProcess: true,
      })),
    },
    metrics: {
      wallMilliseconds: unknown(reason),
      inputTokens: unknown(reason),
      cachedInputTokens: unknown(reason),
      outputTokens: unknown(reason),
      toolLoops: unknown(reason),
      consumedPlanCredits: unknown(reason),
      costUsd: unknown(reason),
    },
    workspace: {},
  };
}

async function retain(runDir: string, relative: string, bytes: Buffer) {
  const absolute = path.join(runDir, relative);
  await mkdir(path.dirname(absolute), { recursive: true });
  await writeFile(absolute, bytes, { flag: 'wx' });
  return { path: relative, sha256: sha256(bytes) };
}

async function initializeStartCommit(workspaceDir: string, seedId: string): Promise<string> {
  const nullDevice = process.platform === 'win32' ? 'NUL' : '/dev/null';
  const env = {
    PATH: process.env.PATH,
    LANG: process.env.LANG ?? 'C',
    LC_ALL: process.env.LC_ALL ?? 'C',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: nullDevice,
    GIT_CONFIG_COUNT: '2',
    GIT_CONFIG_KEY_0: 'core.hooksPath',
    GIT_CONFIG_VALUE_0: nullDevice,
    GIT_CONFIG_KEY_1: 'commit.gpgSign',
    GIT_CONFIG_VALUE_1: 'false',
    GIT_AUTHOR_NAME: 'Phase 0 Fixture',
    GIT_AUTHOR_EMAIL: 'phase0-fixture@example.invalid',
    GIT_AUTHOR_DATE: '2026-07-14T00:00:00Z',
    GIT_COMMITTER_NAME: 'Phase 0 Fixture',
    GIT_COMMITTER_EMAIL: 'phase0-fixture@example.invalid',
    GIT_COMMITTER_DATE: '2026-07-14T00:00:00Z',
  };
  const git = (args: string[]) => execFileAsync(
    'git',
    ['-c', `core.hooksPath=${nullDevice}`, '-c', 'commit.gpgSign=false', ...args],
    { cwd: workspaceDir, env },
  );
  await git(['init', '--quiet']);
  await git(['add', '--all']);
  await git(['commit', '--quiet', '--message', `fixture: ${seedId}`]);
  return (await execFileAsync(
    'git',
    ['-c', `core.hooksPath=${nullDevice}`, 'rev-parse', 'HEAD'],
    { cwd: workspaceDir, env, encoding: 'utf8' },
  )).stdout.trim();
}

async function writeFileMap(root: string, files: Record<string, string>): Promise<void> {
  for (const [relative, contents] of Object.entries(files)) {
    const target = path.join(root, safeRelative(relative));
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, contents, { flag: 'wx' });
  }
}

function safeRelative(value: string): string {
  if (path.isAbsolute(value) || value.split(/[\\/]/).some((part) => part === '..' || part === '')) {
    throw new Error(`unsafe cumulative path: ${value}`);
  }
  return value;
}

function safe(value: string): string {
  if (!/^[A-Za-z0-9._-]+$/.test(value)) throw new Error(`unsafe cumulative id: ${value}`);
  return value;
}

function unknown(reason: string): { status: 'unknown'; reason: string } {
  return { status: 'unknown', reason };
}

function compactCanonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(compactCanonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value as Record<string, unknown>).sort().map((key) =>
      `${JSON.stringify(key)}:${compactCanonical((value as Record<string, unknown>)[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
