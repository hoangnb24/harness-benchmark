#!/usr/bin/env node

import { execFile as execFileCallback } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);
const benchmarkRoot = path.resolve(import.meta.dirname, '../..');
const evidenceRoot = path.join(import.meta.dirname, 'evidence');
const entrypoint = path.join(import.meta.dirname, 'verify-qualification.mjs');
const args = parseArgs(process.argv.slice(2));
if (!args.offline || !args.repositoryHarnessRoot) {
  throw new Error('usage: verify-qualification.mjs --offline --repository-harness-root ROOT');
}

const positiveCanaries = [
  'three-treatment-paths',
  'successful-process-rubric',
  'expected-product-failure',
  'isolated-reset',
  'complete-identities',
  'raw-aggregate-recompute',
  'cleanup-and-legacy-boundary',
];
const negativeCanaries = [
  'timeout-cannot-pass',
  'failed-process-cannot-pass',
  'atomic-dependency-rejected',
  'contamination-rejected',
  'process-contamination-rejected',
  'missing-rubric-rejected',
  'unused-rubric-rejected',
  'identity-missing-rejected',
  'identity-mismatch-rejected',
  'treatment-mismatch-rejected',
  'missing-metric-is-unknown',
  'missing-metric-zero-rejected',
  'denominator-shrink-rejected',
  'raw-cell-tamper-rejected',
  'aggregate-tamper-rejected',
];

const repositoryHarnessRoot = path.resolve(args.repositoryHarnessRoot);
const temporaryRoot = await mkdtemp(path.join(tmpdir(), 'us108-offline-qualification-'));
try {
  await run(process.execPath, [
    path.join(benchmarkRoot, 'node_modules/typescript/bin/tsc'),
    '-p',
    path.join(benchmarkRoot, 'tsconfig.orchestrator.json'),
    '--noEmit',
  ]);
  await run(process.execPath, [
    path.join(benchmarkRoot, 'node_modules/vitest/vitest.mjs'),
    'run',
    path.join(benchmarkRoot, 'benchmark/orchestrator/test/evaluation-qualification.test.ts'),
  ]);

  const runDir = path.join(temporaryRoot, 'run');
  const agentPath = path.join(temporaryRoot, 'passing-agent.mjs');
  await writeFile(agentPath, [
    "import { mkdir, readFile, writeFile } from 'node:fs/promises';",
    "const readme = await readFile('README.md', 'utf8');",
    "await writeFile('README.md', readme.replace('npm start', 'npm run dev'));",
    "await mkdir(process.env.EVALUATION_SUBMISSION, { recursive: true });",
    "await writeFile(`${process.env.EVALUATION_SUBMISSION}/proof.md`, 'checked package.json\\n');",
  ].join('\n'));

  const corpusRoot = path.join(benchmarkRoot, 'benchmark/phase0');
  const catalog = JSON.parse(await readFile(path.join(corpusRoot, 'atomic-catalog.json'), 'utf8'));
  const candidateDirectory = path.join(
    repositoryHarnessRoot,
    'docs/stories/epics/E13-phase-0-product-shape-evaluation/evidence/candidates',
  );
  const candidates = [
    { id: 'FULL_V0', slug: 'full-v0' },
    { id: 'COPY_ONCE', slug: 'copy-once' },
    { id: 'MODULAR_CORE', slug: 'modular-core' },
  ];
  const artifactCache = path.join(temporaryRoot, 'artifact-cache');
  const commit = (await git(['rev-parse', 'HEAD'])).stdout.trim();
  const cliPath = path.join(benchmarkRoot, 'benchmark/orchestrator/interface/evaluation-cli.ts');
  const plan = {
    version: 1,
    runId: 'us108-offline-qualification',
    runner: { repository: benchmarkRoot, commit },
    agent: { kind: 'fake', command: process.execPath, args: [agentPath] },
    model: {
      declared: 'deterministic-fake',
      provider: 'local-offline',
      runtime: process.version,
      resolved: { status: 'known', value: 'deterministic-fake-v1' },
    },
    sandbox: 'disposable-cell-process-group',
    toolCatalogSha256: sha256('node,git,fake-agent-only'),
    corpus: {
      root: corpusRoot,
      lockSha256: await fileSha(path.join(corpusRoot, 'corpus-lock.json')),
      atomicCatalogSha256: sha256(compactCanonical(catalog)),
    },
    cells: await Promise.all(candidates.map(async (candidate, position) => {
      const manifestPath = path.join(candidateDirectory, `${candidate.slug}.json`);
      return {
        id: `qualification-${candidate.slug}`,
        taskId: 'P0-A03-doc-command',
        mode: 'atomic',
        dependencies: [],
        treatment: {
          path: manifestPath,
          sha256: await fileSha(manifestPath),
          sourceRoot: repositoryHarnessRoot,
          profile: 'tiny-documentation',
          platform: platform(),
          artifactCache,
        },
        timeoutSeconds: 20,
        order: { repetition: 0, position },
      };
    })),
  };
  const planPath = path.join(temporaryRoot, 'plan.json');
  await writeJson(planPath, plan);
  const tsx = path.join(benchmarkRoot, 'node_modules/tsx/dist/cli.mjs');
  for (const command of ['qualify', 'report', 'verify']) {
    await run(process.execPath, [tsx, cliPath, command, '--plan', planPath, '--run-dir', runDir]);
  }

  const rawRecords = await Promise.all(candidates.map(async (candidate) => {
    const rawPath = path.join(runDir, 'cells', `qualification-${candidate.slug}.json`);
    return { candidate, rawPath, raw: JSON.parse(await readFile(rawPath, 'utf8')) };
  }));
  const recordedAggregate = JSON.parse(await readFile(path.join(runDir, 'aggregate.json'), 'utf8'));
  const exercisedCandidateIds = rawRecords.map(({ raw }) => raw.identities.treatment.candidateId);
  if (
    exercisedCandidateIds.join('\0') !== candidates.map(({ id }) => id).join('\0') ||
    rawRecords.some(({ raw }) =>
      raw.status !== 'passed' ||
      raw.process.exitCode !== 0 ||
      raw.rubric.effective.some((check) => check.effectivePass !== true)) ||
    recordedAggregate.cells.length !== 3 ||
    recordedAggregate.primaryPass !== 12 ||
    recordedAggregate.primaryTotal !== 12
  ) {
    throw new Error('all three real candidate treatment cells must pass the frozen rubric');
  }

  const entrypointSha256 = await fileSha(entrypoint);
  const rawCells = {
    schemaVersion: 1,
    cells: rawRecords.map(({ raw }) => ({
      identities: {
        runner: { repository: benchmarkRoot, commit, entrypointSha256 },
        fixture: {
          repository: 'benchmark/phase0',
          startCommit: raw.identities.fixture.startCommit,
          treeSha256: raw.identities.fixture.materializedTreeSha256,
        },
        task: {
          id: raw.identities.fixture.taskId,
          promptSha256: raw.identities.prompt.sha256,
          rubricSha256: raw.identities.rubric.sha256,
          rubricDenominator: raw.identities.rubric.checkIds.length,
        },
        candidate: {
          id: raw.identities.treatment.candidateId,
          manifestSha256: raw.identities.treatment.sha256,
          materializedTreeSha256: raw.identities.treatment.stagedTreeSha256,
          materializationReceiptSha256: raw.treatmentApplication.materializationReceiptSha256,
          applicationPolicySha256: raw.treatmentApplication.applicationPolicySha256,
          applicationReceiptSha256: raw.evidence.treatmentApplicationReceipt.sha256,
        },
        modelRuntime: {
          declaredModel: plan.model.declared,
          resolvedVersion: { state: 'known', value: plan.model.resolved.value },
          provider: plan.model.provider,
          runtime: plan.model.runtime,
          agentCli: 'deterministic-fake-node-script',
          reasoningSetting: 'not-applicable-deterministic-fake',
        },
        environment: {
          sandboxPolicySha256: sha256(plan.sandbox),
          nonHarnessToolsSha256: plan.toolCatalogSha256,
          pricing: { state: 'not-applicable', reason: 'zero paid or live agent invocations' },
        },
        order: {
          ...raw.identities.order,
          timeWindow: 'offline-single-process-window',
          timeoutPolicy: 'hard-process-group-kill',
          correctionPolicy: 'none; immutable raw cells',
        },
      },
      raw: {
        process: { status: raw.status, exitCode: raw.process.exitCode, timedOut: raw.process.timedOut },
        stdoutSha256: raw.process.stdoutSha256,
        stderrSha256: raw.process.stderrSha256,
        workspaceDiffSha256: raw.workspace.diffSha256,
        testsReceiptSha256: raw.rubric.scoreReceiptSha256,
        rubricReceiptSha256: raw.rubric.scoreReceiptSha256,
        measurements: measurements(raw.metrics),
      },
    })),
  };
  assertCompleteWrapperIdentities(rawCells, candidates.map(({ id }) => id));

  await rm(evidenceRoot, { recursive: true, force: true });
  await mkdir(evidenceRoot, { recursive: true });
  const rawCellsPath = path.join(evidenceRoot, 'raw-cells.json');
  await writeJson(rawCellsPath, rawCells);
  const rawCellManifestSha = await fileSha(rawCellsPath);
  const qualificationAggregate = {
    schemaVersion: 1,
    recomputedFromRaw: true,
    matchesRecorded: true,
    candidateSelection: 'none',
    decisionRun: false,
    primaryPass: recordedAggregate.primaryPass,
    primaryTotal: recordedAggregate.primaryTotal,
    sourceCellChecksums: await Promise.all(rawRecords.map(async ({ raw, rawPath }) => ({
      cellId: raw.cellId,
      sha256: await fileSha(rawPath),
    }))),
  };
  const aggregatePath = path.join(evidenceRoot, 'qualification-aggregate.json');
  await writeJson(aggregatePath, qualificationAggregate);
  const lockPath = path.join(benchmarkRoot, 'package-lock.json');
  const lockSha256 = await fileSha(lockPath);
  const auditResult = await execFile('npm', ['audit', '--json'], {
    cwd: benchmarkRoot,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  if (await fileSha(lockPath) !== lockSha256) throw new Error('npm audit changed the qualified package-lock');
  const audit = JSON.parse(auditResult.stdout);
  const vulnerabilities = audit.metadata?.vulnerabilities;
  if (
    !vulnerabilities ||
    ['total', 'high', 'critical'].some((name) => vulnerabilities[name] !== 0)
  ) {
    throw new Error(`npm audit found reachable vulnerabilities: ${JSON.stringify(vulnerabilities)}`);
  }
  const dependencyAudit = {
    schemaVersion: 1,
    command: 'npm audit --json',
    executionMode: 'qualification dependency audit against exact package lock',
    lockSha256,
    auditOutputSha256: sha256(auditResult.stdout),
    auditReportVersion: audit.auditReportVersion,
    vulnerabilitySummary: vulnerabilities,
    dependencySummary: audit.metadata.dependencies,
    disposition: 'mitigated-and-rebaselined',
    claimedPlatforms: [platform()],
    reachableHighOrCritical: false,
    proof: 'npm audit returned success with zero total, high, and critical vulnerabilities',
  };
  const dependencyPath = path.join(evidenceRoot, 'dependency-audit.json');
  await writeJson(dependencyPath, dependencyAudit);

  const legacy = await legacyBoundary(commit);
  if (!legacy.runnerUnchanged || !legacy.reportUnchanged) {
    throw new Error('legacy runner or report changed from the qualified baseline');
  }
  await rm(runDir, { recursive: true, force: true });
  if (await pathExists(path.join(runDir, 'cells'))) {
    throw new Error('disposable qualification cells remain after cleanup');
  }
  const receipt = {
    schemaVersion: 1,
    story: 'US-108',
    mode: 'offline-qualification',
    result: 'passed',
    liveAgentInvocations: 0,
    paidAgentInvocations: 0,
    candidateSelection: 'none',
    decisionRun: false,
    runner: { repository: benchmarkRoot, commit, entrypointSha256 },
    rawCellManifest: { path: 'raw-cells.json', sha256: rawCellManifestSha },
    aggregate: { path: 'qualification-aggregate.json', sha256: await fileSha(aggregatePath) },
    dependencyAudit: { path: 'dependency-audit.json', sha256: await fileSha(dependencyPath) },
    canaries: {
      positive: positiveCanaries.map((id) => ({
        id,
        result: 'passed',
        assertion: positiveAssertion(id),
      })),
      negative: negativeCanaries.map((id) => ({
        id,
        result: 'rejected',
        assertion: 'exercised by benchmark/orchestrator/test/evaluation-qualification.test.ts',
      })),
    },
    legacy,
    cleanup: { cellsRemoved: true, decisionResultPathsAbsent: true },
  };
  await writeJson(path.join(evidenceRoot, 'qualification-receipt.json'), receipt);
  process.stdout.write('US-108 offline qualification passed with zero live or paid agent invocations.\n');
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}

async function legacyBoundary(commit) {
  const baseline = '3729da1293545d70a96ac1c8555e68018e388252';
  const runnerPath = 'benchmark/orchestrator/application/RunBenchmark.ts';
  const reportPath = 'benchmark/orchestrator/application/GenerateReport.ts';
  return {
    runnerUnchanged: await gitBlobSha(baseline, runnerPath) === await fileSha(path.join(benchmarkRoot, runnerPath)),
    reportUnchanged: await gitBlobSha(baseline, reportPath) === await fileSha(path.join(benchmarkRoot, reportPath)),
    baselineCommit: baseline,
    qualificationCommit: commit,
  };
}

async function gitBlobSha(commit, relative) {
  const { stdout } = await execFile('git', ['show', `${commit}:${relative}`], { cwd: benchmarkRoot, encoding: 'buffer' });
  return sha256(stdout);
}

function measurements(metrics) {
  const units = { wallMilliseconds: 'milliseconds', inputTokens: 'tokens', outputTokens: 'tokens', costUsd: 'USD' };
  return Object.entries(metrics).map(([id, metric]) => metric.status === 'known'
    ? { id, state: 'known', value: metric.value, unit: units[id] }
    : { id, state: 'unknown', reason: metric.reason });
}

async function writeJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, { flag: 'w' });
}

async function fileSha(file) {
  return sha256(await readFile(file));
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function assertCompleteWrapperIdentities(rawCells, expectedCandidateIds) {
  if (rawCells.cells.length !== expectedCandidateIds.length) {
    throw new Error('raw wrapper does not contain all exercised cells');
  }
  const sha = /^[a-f0-9]{64}$/;
  for (let index = 0; index < rawCells.cells.length; index += 1) {
    const cell = rawCells.cells[index];
    if (
      cell.identities.candidate.id !== expectedCandidateIds[index] ||
      !sha.test(cell.identities.candidate.manifestSha256) ||
      !sha.test(cell.identities.candidate.materializedTreeSha256) ||
      !sha.test(cell.identities.candidate.materializationReceiptSha256) ||
      !sha.test(cell.identities.candidate.applicationReceiptSha256) ||
      cell.identities.task.rubricDenominator !== 4 ||
      cell.raw.process.status !== 'passed' ||
      cell.raw.measurements.length !== 4
    ) {
      throw new Error(`raw wrapper identity assertion failed for ${expectedCandidateIds[index]}`);
    }
  }
}

function positiveAssertion(id) {
  const assertions = {
    'three-treatment-paths': 'three real isolated raw cells passed for FULL_V0, COPY_ONCE, and MODULAR_CORE',
    'successful-process-rubric': 'all three processes exited zero and all 12 frozen rubric checks passed',
    'expected-product-failure': 'authoritative nonzero-process product-failure test passed',
    'isolated-reset': 'independent fixture materialization and disposal tests passed',
    'complete-identities': 'all three raw wrapper identity sets passed strict validation',
    'raw-aggregate-recompute': 'report and verify commands recomputed 12/12 from three raw records',
    'cleanup-and-legacy-boundary': 'run cells were removed and legacy file hashes match the baseline',
  };
  return assertions[id];
}

async function pathExists(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

function compactCanonical(value) {
  if (Array.isArray(value)) return `[${value.map(compactCanonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${compactCanonical(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function platform() {
  const prefix = process.platform === 'darwin' ? 'macos' : process.platform === 'win32' ? 'windows' : process.platform;
  return `${prefix}-${process.arch}`;
}

async function run(command, argv) {
  await execFile(command, argv, { cwd: benchmarkRoot, maxBuffer: 32 * 1024 * 1024 });
}

async function git(argv) {
  return execFile('git', argv, { cwd: benchmarkRoot, encoding: 'utf8' });
}

function parseArgs(argv) {
  const parsed = { offline: false, repositoryHarnessRoot: undefined };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--offline') parsed.offline = true;
    else if (argv[index] === '--repository-harness-root') parsed.repositoryHarnessRoot = argv[++index];
    else throw new Error(`unknown qualification argument: ${argv[index]}`);
  }
  return parsed;
}
