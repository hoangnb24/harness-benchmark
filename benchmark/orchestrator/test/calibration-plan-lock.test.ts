import { execFile as execFileCallback } from 'node:child_process';
import { chmod, copyFile, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import {
  assertExactCalibrationEvaluationPlan,
  assertCalibrationExecutionSnapshot,
  assembleCalibrationEvaluationPlan,
  buildCalibrationPlanCore,
  verifyCalibrationEvaluationPlanFile,
  writeCalibrationEvaluationPlan,
  type BuiltCalibrationPlanCore,
  type CalibrationEnvironmentBinding,
  type CalibrationGovernanceInput,
  CALIBRATION_EXECUTION_ARTIFACTS,
} from '../infrastructure/CalibrationPlanLock';
import { codexExecutionPlanSha } from '../infrastructure/CodexExecutionAuthorization';
import { canonicalJson, sha256 } from '../infrastructure/EvaluationFiles';
import { runCalibrationPlanCli } from '../interface/calibration-plan-cli';

const roots: string[] = [];
const benchmarkRoot = path.resolve('.');
const sourceRoot = path.resolve('../repository-harness');
const execFile = promisify(execFileCallback);

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('US-031 executable Gate D0 calibration plan lock', () => {
  it('builds the exact canonical 18-cell plan without a hash cycle or live executable call', async () => {
    const fixture = await inputsFixture();
    const built = await buildCalibrationPlanCore(fixture.paths);
    const authorization = await approvedAuthorization(fixture, built);
    const planPath = path.join(fixture.root, 'evaluation-plan.json');
    const plan = await writeCalibrationEvaluationPlan(planPath, built, authorization);

    expect(plan.runner).toEqual({ repository: 'harness-benchmark', commit: fixture.executionCommit });
    expect(plan.runId).toBe('e13-gate-d0-calibration-v3');
    expect(plan.cells.map((cell) => cell.id)).toEqual(
      Array.from({ length: 18 }, (_, index) => `C${String(index + 1).padStart(2, '0')}`),
    );
    expect(plan.cells.every((cell) => cell.timeoutSeconds === 600)).toBe(true);
    expect(new Set(plan.cells.map((cell) => cell.treatment.profile))).toEqual(
      new Set(['bounded-defect-repair', 'brownfield-ownership']),
    );
    expect(plan.cells.every((cell) =>
      cell.treatment.platform === 'macos-arm64' &&
      cell.treatment.sourceRoot === sourceRoot &&
      cell.treatment.artifactCache === fixture.environment.artifactCache),
    ).toBe(true);
    expect(plan.model).toEqual({
      declared: 'gpt-5.6-sol',
      provider: 'openai',
      runtime: process.version,
      resolved: { status: 'unknown', reason: 'no live provider call has occurred' },
    });
    expect(codexExecutionPlanSha(plan)).toBe(built.semanticSha256);
    expect(plan.agent.kind).toBe('codex');
    if (plan.agent.kind !== 'codex') throw new Error('test requires Codex plan');
    expect(plan.agent.authorization.sha256).toBe(authorization.sha256);
    expect(await readFile(planPath, 'utf8')).toBe(canonicalJson(plan));
    await expect(verifyCalibrationEvaluationPlanFile(planPath, built)).resolves.toEqual(plan);
    await expect(assertCalibrationExecutionSnapshot(plan)).resolves.toMatchObject({
      benchmarkRoot: fixture.environment.benchmarkRoot,
      packetLockSha256: fixture.governance.identities.packetLockSha256,
    });

    await writeFile(
      path.join(fixture.environment.benchmarkRoot, 'benchmark/calibration/e13/analysis-policy.json'),
      '{}\n',
    );
    await expect(assertCalibrationExecutionSnapshot(plan)).rejects.toThrow(
      'calibration packet identity benchmark/calibration/e13/analysis-policy.json checksum mismatch',
    );
    await copyFile(
      path.join(benchmarkRoot, 'benchmark/calibration/e13/analysis-policy.json'),
      path.join(fixture.environment.benchmarkRoot, 'benchmark/calibration/e13/analysis-policy.json'),
    );

    const rebuilt = await buildCalibrationPlanCore(fixture.paths);
    expect(rebuilt.planCore).toEqual(built.planCore);
    expect(rebuilt.semanticSha256).toBe(built.semanticSha256);
  }, 30_000);

  it('exposes the semantic plan digest through an offline-only CLI', async () => {
    const fixture = await inputsFixture();
    const output: string[] = [];
    const errors: string[] = [];
    const code = await runCalibrationPlanCli([
      'core',
      '--governance', fixture.paths.governancePath,
      '--environment', fixture.paths.environmentBindingPath,
      '--pricing', fixture.paths.pricingPolicyPath,
      '--tool-policy', fixture.paths.toolPolicyPath,
    ], { stdout: (message) => output.push(message), stderr: (message) => errors.push(message) });
    expect(code).toBe(0);
    expect(errors).toEqual([]);
    expect(JSON.parse(output.join(''))).toMatchObject({
      executionCommit: fixture.executionCommit,
      liveProviderCalls: 0,
    });
  }, 30_000);

  it('rejects governance, environment, executable, rate, tool, authorization, and final-plan mutations offline', async () => {
    await expectMutation('governance plan/auth back-reference', async (fixture) => {
      await canonicalWrite(fixture.paths.governancePath, { ...fixture.governance, executionPlanSha: '0'.repeat(64) });
      await buildCalibrationPlanCore(fixture.paths);
    }, 'field set mismatch');

    await expectMutation('execution commit', async (fixture) => {
      fixture.governance.runner.executionCommit = '0'.repeat(40) as CalibrationGovernanceInput['runner']['executionCommit'];
      await canonicalWrite(fixture.paths.governancePath, fixture.governance);
      await buildCalibrationPlanCore(fixture.paths);
    }, 'execution commit snapshot is invalid');

    await expectMutation('qualified ancestry identity', async (fixture) => {
      fixture.governance.runner.qualifiedBaseCommit = '0'.repeat(40) as CalibrationGovernanceInput['runner']['qualifiedBaseCommit'];
      await canonicalWrite(fixture.paths.governancePath, fixture.governance);
      await buildCalibrationPlanCore(fixture.paths);
    }, 'fixed values mismatch');

    await expectMutation('environment path', async (fixture) => {
      fixture.environment.runDirectory = path.join(benchmarkRoot, 'benchmark/evaluation/calibration-runs/wrong');
      await canonicalWrite(fixture.paths.environmentBindingPath, fixture.environment);
      await buildCalibrationPlanCore(fixture.paths);
    }, 'run directory path mismatch');

    await expectMutation('platform', async (fixture) => {
      fixture.environment.platform = 'linux-x64' as CalibrationEnvironmentBinding['platform'];
      await canonicalWrite(fixture.paths.environmentBindingPath, fixture.environment);
      await buildCalibrationPlanCore(fixture.paths);
    }, 'values are invalid');

    await expectMutation('executable bytes', async (fixture) => {
      await writeFile(fixture.environment.executable.path, '#!/bin/sh\nexit 9\n');
      await buildCalibrationPlanCore(fixture.paths);
    }, 'executable checksum mismatch');

    await expectMutation('live runner bytes after commit', async (fixture) => {
      await writeFile(
        path.join(fixture.environment.benchmarkRoot, 'benchmark/orchestrator/interface/evaluation-cli.ts'),
        '// post-commit mutation\n',
      );
      await buildCalibrationPlanCore(fixture.paths);
    }, 'live execution artifact differs from commit');

    await expectMutation('packet member bytes after commit', async (fixture) => {
      await writeFile(
        path.join(fixture.environment.benchmarkRoot, 'benchmark/calibration/e13/analysis-policy.json'),
        '{}\n',
      );
      await buildCalibrationPlanCore(fixture.paths);
    }, 'calibration packet identity benchmark/calibration/e13/analysis-policy.json checksum mismatch');

    await expectMutation('candidate bytes after pinned source commit', async (fixture) => {
      const fixtureSourceRoot = path.join(fixture.root, 'source-repository');
      await execFile('git', ['clone', '--quiet', '--shared', sourceRoot, fixtureSourceRoot]);
      fixture.environment.sourceRoot = fixtureSourceRoot;
      await canonicalWrite(fixture.paths.environmentBindingPath, fixture.environment);
      await writeFile(
        path.join(
          fixtureSourceRoot,
          'docs/stories/epics/E13-phase-0-product-shape-evaluation/evidence/candidates/full-v0.json',
        ),
        '{}\n',
      );
      await buildCalibrationPlanCore(fixture.paths);
    }, 'calibration candidate source snapshot is invalid');

    await expectMutation('pricing version/fields', async (fixture) => {
      await canonicalWrite(fixture.paths.pricingPolicyPath, { ...fixture.pricing, schemaVersion: 2 });
      await buildCalibrationPlanCore(fixture.paths);
    }, 'runner-compatible v1');

    await expectMutation('tool policy', async (fixture) => {
      await canonicalWrite(fixture.paths.toolPolicyPath, { ...fixture.toolPolicy, allowedTools: ['shell'] });
      await buildCalibrationPlanCore(fixture.paths);
    }, 'runner-compatible v1');

    const fixture = await inputsFixture();
    const built = await buildCalibrationPlanCore(fixture.paths);
    const wrongAuthorization = await approvedAuthorization(fixture, built, { executionPlanSha: '0'.repeat(64) });
    await expect(assembleCalibrationEvaluationPlan(built, wrongAuthorization)).rejects.toThrow(
      'executionPlanSha mismatch',
    );
    const rejectedOvershoot = await approvedAuthorization(fixture, built, {
      acceptsPossibleOneAdmittedCallCreditOvershoot: false,
    });
    await expect(assembleCalibrationEvaluationPlan(built, rejectedOvershoot)).rejects.toThrow(
      'acceptsPossibleOneAdmittedCallCreditOvershoot mismatch',
    );

    const authorization = await approvedAuthorization(fixture, built);
    const plan = await assembleCalibrationEvaluationPlan(built, authorization);
    const timeoutMutation = structuredClone(plan);
    timeoutMutation.cells[0].timeoutSeconds = 599;
    expect(() => assertExactCalibrationEvaluationPlan(timeoutMutation, built)).toThrow('cell environment mismatch');
    const profileMutation = structuredClone(plan);
    profileMutation.cells[0].treatment.profile = 'wrong-profile';
    expect(() => assertExactCalibrationEvaluationPlan(profileMutation, built)).toThrow('cell environment mismatch');

    const planPath = path.join(fixture.root, 'mutated-plan.json');
    await canonicalWrite(planPath, { ...plan, unexpected: true });
    await expect(verifyCalibrationEvaluationPlanFile(planPath, built)).rejects.toThrow('field set mismatch');
    const noncanonicalPath = path.join(fixture.root, 'noncanonical-plan.json');
    await writeFile(noncanonicalPath, JSON.stringify(plan));
    await expect(verifyCalibrationEvaluationPlanFile(noncanonicalPath, built)).rejects.toThrow('not canonical JSON');
  }, 30_000);
});

interface Fixture {
  root: string;
  paths: {
    governancePath: string;
    environmentBindingPath: string;
    pricingPolicyPath: string;
    toolPolicyPath: string;
  };
  governance: CalibrationGovernanceInput;
  environment: CalibrationEnvironmentBinding;
  pricing: Record<string, unknown>;
  toolPolicy: Record<string, unknown>;
  executionCommit: string;
}

async function inputsFixture(): Promise<Fixture> {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'us031-plan-lock-')));
  roots.push(root);
  const fixtureBenchmarkRoot = path.join(root, 'benchmark-repository');
  await execFile('git', ['clone', '--quiet', '--shared', benchmarkRoot, fixtureBenchmarkRoot]);
  await execFile('git', ['checkout', '--quiet', '--detach', 'efe0ba913b98a3ae9d991fe5c1b609eed81699d8'], {
    cwd: fixtureBenchmarkRoot,
  });
  const packet = JSON.parse(
    await readFile(path.join(benchmarkRoot, 'benchmark/calibration/e13/packet-lock.json'), 'utf8'),
  ) as { identities: Array<{ path: string }> };
  const snapshotPaths = [...new Set([
    ...CALIBRATION_EXECUTION_ARTIFACTS,
    ...packet.identities.map((identity) => identity.path),
  ])];
  for (const relative of snapshotPaths) {
    const target = path.join(fixtureBenchmarkRoot, relative);
    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(path.join(benchmarkRoot, relative), target);
  }
  await execFile('git', ['add', '--', ...snapshotPaths], { cwd: fixtureBenchmarkRoot });
  await execFile('git', [
    '-c', 'user.name=Offline Plan Test', '-c', 'user.email=offline@example.invalid',
    '-c', 'commit.gpgSign=false', '-c', 'core.hooksPath=/dev/null',
    'commit', '--quiet', '-m', 'test: executable calibration snapshot',
  ], { cwd: fixtureBenchmarkRoot });
  const executionCommit = (await execFile('git', ['rev-parse', 'HEAD'], { cwd: fixtureBenchmarkRoot })).stdout.trim();
  const executablePath = path.join(root, 'codex-do-not-run');
  await writeFile(executablePath, '#!/bin/sh\necho should-not-run >&2\nexit 99\n');
  await chmod(executablePath, 0o755);
  const governancePath = path.join(root, 'governance.json');
  const environmentBindingPath = path.join(root, 'environment.json');
  const pricingPolicyPath = path.join(root, 'pricing.json');
  const toolPolicyPath = path.join(root, 'tools.json');
  const governance: CalibrationGovernanceInput = {
    schemaVersion: 1,
    protocolId: 'e13-gate-d0-calibration-v3',
    packetId: 'e13-gate-d0-held-out-v3',
    runner: {
      repository: 'harness-benchmark',
      executionCommit,
      qualifiedBaseCommit: '2013dd55bac4c4bbc5bd9eff950eeb6f24d999ef',
    },
    run: {
      runId: 'e13-gate-d0-calibration-v3',
      relativeDirectory: 'benchmark/evaluation/calibration-runs/e13-gate-d0-calibration-v3',
      concurrency: 1,
      retries: 0,
      infrastructureFailureDisposition: 'invalidate-complete-calibration-packet',
    },
    agent: {
      scope: 'calibration',
      authentication: 'chatgpt-plan-only',
      model: 'gpt-5.6-sol',
      provider: 'openai',
      reasoningEffort: 'max',
      sandbox: 'workspace-write',
      apiBillingAllowed: false,
      purchasedCreditsAllowed: false,
      overageAllowed: false,
    },
    execution: { plannedInvocations: 18, cellTimeoutSeconds: 600 },
    identities: {
      packetLockSha256: await fileSha(path.join(fixtureBenchmarkRoot, 'benchmark/calibration/e13/packet-lock.json')),
      scheduleSha256: await fileSha(path.join(fixtureBenchmarkRoot, 'benchmark/calibration/e13/schedule.json')),
      corpusLockSha256: await fileSha(path.join(fixtureBenchmarkRoot, 'benchmark/calibration/e13/corpus/corpus-lock.json')),
      atomicCatalogSha256: await fileSha(path.join(fixtureBenchmarkRoot, 'benchmark/calibration/e13/corpus/atomic-catalog.json')),
      candidateIdentitiesSha256: await fileSha(path.join(fixtureBenchmarkRoot, 'benchmark/calibration/e13/candidate-identities.json')),
    },
  };
  const environment: CalibrationEnvironmentBinding = {
    schemaVersion: 1,
    bindingId: 'offline-macos-arm64-test',
    benchmarkRoot: fixtureBenchmarkRoot,
    sourceRoot,
    artifactCache: path.join(fixtureBenchmarkRoot, 'benchmark/evaluation/artifact-cache'),
    runDirectory: path.join(fixtureBenchmarkRoot, 'benchmark/evaluation/calibration-runs/e13-gate-d0-calibration-v3'),
    platform: 'macos-arm64',
    nodeRuntime: process.version,
    executable: {
      path: executablePath,
      sha256: await fileSha(executablePath),
      version: '0.offline-do-not-run',
    },
  };
  const pricing = {
    schemaVersion: 1,
    model: 'gpt-5.6-sol',
    unit: 'credits-per-million-tokens',
    rates: { input: 125, cachedInput: 12.5, output: 750 },
    source: 'offline-test-only',
    effectiveDate: '2026-07-14',
  };
  const toolPolicy = {
    schemaVersion: 1,
    codexVersion: environment.executable.version,
    allowedTools: ['shell', 'apply_patch'],
    forbiddenCapabilities: ['connectors', 'mcp', 'subagents', 'browser', 'computer', 'image'],
    featureOverrides: Object.fromEntries([
      'apps', 'auth_elicitation', 'browser_use', 'browser_use_external',
      'browser_use_full_cdp_access', 'computer_use', 'enable_fanout', 'enable_mcp_apps',
      'goals', 'image_generation', 'in_app_browser', 'multi_agent', 'plugins',
      'remote_plugin', 'skill_mcp_dependency_install', 'tool_call_mcp_elicitation',
    ].map((name) => [name, false])),
    webSearch: 'disabled',
    networkAccess: false,
  };
  await canonicalWrite(governancePath, governance);
  await canonicalWrite(environmentBindingPath, environment);
  await canonicalWrite(pricingPolicyPath, pricing);
  await canonicalWrite(toolPolicyPath, toolPolicy);
  return {
    root,
    paths: { governancePath, environmentBindingPath, pricingPolicyPath, toolPolicyPath },
    governance,
    environment,
    pricing,
    toolPolicy,
    executionCommit,
  };
}

async function approvedAuthorization(
  fixture: Fixture,
  built: BuiltCalibrationPlanCore,
  overrides: Record<string, unknown> = {},
): Promise<{ path: string; sha256: string }> {
  const authorizationPath = path.join(fixture.root, `authorization-${Object.keys(overrides).join('-') || 'approved'}.json`);
  const exactTemplate = JSON.parse(await readFile(
    path.join(benchmarkRoot, 'benchmark/calibration/e13/gate-d0-approval-template.json'),
    'utf8',
  )) as Record<string, unknown>;
  const authorization = {
    ...exactTemplate,
    schemaVersion: 1,
    gate: 'D0',
    protocolId: fixture.governance.protocolId,
    protocolSha: await fileSha(fixture.paths.governancePath),
    state: 'approved',
    approver: 'Offline Test Approver',
    approverRole: 'Benchmark Maintainer',
    approvedAt: '2026-07-14T00:00:00Z',
    statement: 'Approve only this checksum-pinned offline test calibration contract.',
    openBlockers: [],
    runId: fixture.governance.run.runId,
    scope: 'calibration',
    model: fixture.governance.agent.model,
    reasoningEffort: fixture.governance.agent.reasoningEffort,
    executableSha: fixture.environment.executable.sha256,
    pricingPolicySha: await fileSha(fixture.paths.pricingPolicyPath),
    toolPolicySha: await fileSha(fixture.paths.toolPolicyPath),
    authMode: 'chatgpt',
    maxInvocations: 18,
    maxPlanCredits: 1000,
    maxElapsedSeconds: 10800,
    perInvocationCreditReserve: 40,
    authorizesLiveExecution: true,
    authorizesCalibration: true,
    authorizesUS110: false,
    authorizesApiBilling: false,
    authorizesPurchasedCredits: false,
    authorizesOverage: false,
    acceptsPossibleOneAdmittedCallCreditOvershoot: true,
    executionPlanSha: built.semanticSha256,
    runDirectory: fixture.environment.runDirectory,
    ...overrides,
  };
  await canonicalWrite(authorizationPath, authorization);
  return { path: authorizationPath, sha256: await fileSha(authorizationPath) };
}

async function expectMutation(
  _label: string,
  mutate: (fixture: Fixture) => Promise<void>,
  expected: string,
): Promise<void> {
  const fixture = await inputsFixture();
  await expect(mutate(fixture)).rejects.toThrow(expected);
}

async function canonicalWrite(filePath: string, value: unknown): Promise<void> {
  await writeFile(filePath, canonicalJson(value));
}

async function fileSha(filePath: string): Promise<string> {
  return sha256(await readFile(filePath));
}
