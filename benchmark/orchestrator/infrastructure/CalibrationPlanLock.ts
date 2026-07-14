import { execFile as execFileCallback } from 'node:child_process';
import { lstat, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import {
  CALIBRATION_PLANNED_INVOCATIONS,
  HELD_OUT_CALIBRATION_RUN_ID,
} from '../domain/calibration';
import { validateEvaluationPlan, type EvaluationPlan } from '../domain/evaluation';
import {
  codexExecutionPlanSha,
  verifyCodexExecutionAuthorization,
  type CodexPricingPolicy,
  type CodexToolPolicy,
} from './CodexExecutionAuthorization';
import { assertSha256, canonicalJson, sha256 } from './EvaluationFiles';

const execFile = promisify(execFileCallback);
const PACKET_ID = 'e13-gate-d0-held-out-v1';
const MODEL = 'gpt-5.6-sol';
export const HELD_OUT_CALIBRATION_RUN_DIRECTORY =
  'benchmark/evaluation/calibration-runs/e13-gate-d0-calibration-v1';
export const HELD_OUT_CALIBRATION_QUALIFIED_BASE_COMMIT =
  '2013dd55bac4c4bbc5bd9eff950eeb6f24d999ef';
export const HELD_OUT_CALIBRATION_TIMEOUT_SECONDS = 600;
export const HELD_OUT_CALIBRATION_PLATFORM = 'macos-arm64';
export const CALIBRATION_EXECUTION_ARTIFACTS = [
  'benchmark/calibration/e13/packet-lock.json',
  'benchmark/orchestrator/application/GenerateBlindedCalibrationReport.ts',
  'benchmark/orchestrator/application/RunCalibrationPlan.ts',
  'benchmark/orchestrator/infrastructure/CalibrationPlanLock.ts',
  'benchmark/orchestrator/infrastructure/CodexExecutionAuthorization.ts',
  'benchmark/orchestrator/interface/evaluation-cli.ts',
] as const;
const DISABLED_FEATURES = [
  'apps', 'auth_elicitation', 'browser_use', 'browser_use_external',
  'browser_use_full_cdp_access', 'computer_use', 'enable_fanout', 'enable_mcp_apps',
  'goals', 'image_generation', 'in_app_browser', 'multi_agent', 'plugins',
  'remote_plugin', 'skill_mcp_dependency_install', 'tool_call_mcp_elicitation',
].sort();

type CodexAgent = Extract<EvaluationPlan['agent'], { kind: 'codex' }>;

export type CalibrationPlanCore = Omit<EvaluationPlan, 'agent'> & {
  agent: Omit<CodexAgent, 'authorization'>;
};

export interface CalibrationGovernanceInput {
  schemaVersion: 1;
  protocolId: 'e13-gate-d0-calibration-v1';
  packetId: 'e13-gate-d0-held-out-v1';
  runner: {
    repository: 'harness-benchmark';
    executionCommit: string;
    qualifiedBaseCommit: typeof HELD_OUT_CALIBRATION_QUALIFIED_BASE_COMMIT;
  };
  run: {
    runId: typeof HELD_OUT_CALIBRATION_RUN_ID;
    relativeDirectory: typeof HELD_OUT_CALIBRATION_RUN_DIRECTORY;
    concurrency: 1;
    retries: 0;
    infrastructureFailureDisposition: 'invalidate-complete-calibration-packet';
  };
  agent: {
    scope: 'calibration';
    authentication: 'chatgpt-plan-only';
    model: typeof MODEL;
    provider: 'openai';
    reasoningEffort: 'max';
    sandbox: 'workspace-write';
    apiBillingAllowed: false;
    purchasedCreditsAllowed: false;
    overageAllowed: false;
  };
  execution: {
    plannedInvocations: 18;
    cellTimeoutSeconds: typeof HELD_OUT_CALIBRATION_TIMEOUT_SECONDS;
  };
  identities: {
    packetLockSha256: string;
    scheduleSha256: string;
    corpusLockSha256: string;
    atomicCatalogSha256: string;
    candidateIdentitiesSha256: string;
  };
}

export interface CalibrationEnvironmentBinding {
  schemaVersion: 1;
  bindingId: string;
  benchmarkRoot: string;
  sourceRoot: string;
  artifactCache: string;
  runDirectory: string;
  platform: typeof HELD_OUT_CALIBRATION_PLATFORM;
  nodeRuntime: string;
  executable: { path: string; sha256: string; version: string };
}

export interface CalibrationPlanInputPaths {
  governancePath: string;
  environmentBindingPath: string;
  pricingPolicyPath: string;
  toolPolicyPath: string;
}

export interface BuiltCalibrationPlanCore {
  planCore: CalibrationPlanCore;
  semanticSha256: string;
  governance: CalibrationGovernanceInput;
  environment: CalibrationEnvironmentBinding;
}

export interface CalibrationExecutionSnapshot {
  benchmarkRoot: string;
  packetLockSha256: string;
  analysisPolicySha256: string;
}

export async function buildCalibrationPlanCore(
  inputs: CalibrationPlanInputPaths,
): Promise<BuiltCalibrationPlanCore> {
  const governanceFile = await readCanonicalJsonFile(inputs.governancePath, 'calibration governance');
  const environmentFile = await readCanonicalJsonFile(inputs.environmentBindingPath, 'calibration environment binding');
  const pricingFile = await readCanonicalJsonFile(inputs.pricingPolicyPath, 'calibration pricing policy');
  const toolFile = await readCanonicalJsonFile(inputs.toolPolicyPath, 'calibration tool policy');
  const governance = parseGovernance(governanceFile.value);
  const environment = await parseEnvironment(environmentFile.value);
  const pricing = parsePricingPolicy(pricingFile.value);
  const toolPolicy = parseToolPolicy(toolFile.value, environment.executable.version);
  if (pricing.model !== governance.agent.model) throw new Error('calibration pricing policy model mismatch');

  await assertGitExecutionSnapshot(environment.benchmarkRoot, governance.runner.executionCommit);
  await assertGovernanceIdentities(
    environment.benchmarkRoot,
    governance.runner.executionCommit,
    governance.identities,
  );
  await assertPacketIdentitySnapshot(
    environment.benchmarkRoot,
    governance.runner.executionCommit,
    governance.identities.packetLockSha256,
  );
  await assertExecutableIdentity(environment.executable);

  const candidatePath = path.join(environment.benchmarkRoot, 'benchmark/calibration/e13/candidate-identities.json');
  const schedulePath = path.join(environment.benchmarkRoot, 'benchmark/calibration/e13/schedule.json');
  const corpusRoot = path.join(environment.benchmarkRoot, 'benchmark/calibration/e13/corpus');
  const corpusLockPath = path.join(corpusRoot, 'corpus-lock.json');
  const candidates = parseCandidates(JSON.parse(await readFile(candidatePath, 'utf8')) as unknown);
  const schedule = parseSchedule(JSON.parse(await readFile(schedulePath, 'utf8')) as unknown);
  const corpusLock = parseCorpusLock(JSON.parse(await readFile(corpusLockPath, 'utf8')) as unknown);
  const treatments = new Map(candidates.treatments.map((treatment) => [treatment.id, treatment]));
  const taskProfiles = new Map([
    ['H01-config-precedence', 'bounded-defect-repair'],
    ['H02-brownfield-script-merge', 'brownfield-ownership'],
  ]);
  const cells = schedule.calls.map((call, position) => {
    const treatment = treatments.get(call.treatment);
    const profile = taskProfiles.get(call.taskId);
    if (!treatment || !profile) throw new Error(`calibration schedule identity is unresolved: ${call.callId}`);
    const manifestPath = path.join(environment.sourceRoot, candidates.manifestRoot, treatment.file);
    return {
      id: call.callId,
      taskId: call.taskId,
      mode: 'atomic' as const,
      dependencies: [],
      treatment: {
        path: manifestPath,
        sha256: treatment.sha256,
        sourceRoot: environment.sourceRoot,
        profile,
        platform: environment.platform,
        artifactCache: environment.artifactCache,
      },
      timeoutSeconds: governance.execution.cellTimeoutSeconds,
      order: { repetition: call.repetition, position },
    };
  });
  await assertCandidateSourceSnapshot(environment.sourceRoot, candidates);
  for (const cell of cells) await assertFileSha(cell.treatment.path, cell.treatment.sha256, `treatment ${cell.id}`);

  const planCore: CalibrationPlanCore = {
    version: 1,
    runId: governance.run.runId,
    runner: { repository: governance.runner.repository, commit: governance.runner.executionCommit },
    agent: {
      kind: 'codex',
      executable: environment.executable,
      scope: 'calibration',
      protocol: { path: governanceFile.path, sha256: governanceFile.sha256 },
      pricingPolicy: { path: pricingFile.path, sha256: pricingFile.sha256 },
      toolPolicy: { path: toolFile.path, sha256: toolFile.sha256 },
    },
    model: {
      declared: governance.agent.model,
      provider: governance.agent.provider,
      runtime: environment.nodeRuntime,
      resolved: { status: 'unknown', reason: 'no live provider call has occurred' },
    },
    reasoningEffort: governance.agent.reasoningEffort,
    sandbox: governance.agent.sandbox,
    toolCatalogSha256: toolFile.sha256,
    corpus: {
      root: corpusRoot,
      lockSha256: governance.identities.corpusLockSha256,
      atomicCatalogSha256: corpusLock.atomicCatalogSha256,
    },
    cells,
    cumulativeJourneys: [],
  };
  const semanticSha256 = sha256(canonicalJson(planCore));
  return { planCore, semanticSha256, governance, environment };
}

export async function assertCalibrationExecutionSnapshot(
  plan: EvaluationPlan,
): Promise<CalibrationExecutionSnapshot> {
  if (plan.agent.kind !== 'codex' || plan.agent.scope !== 'calibration') {
    throw new Error('calibration execution snapshot requires a Codex calibration plan');
  }
  const governanceFile = await readCanonicalJsonFile(plan.agent.protocol.path, 'calibration governance');
  if (governanceFile.sha256 !== plan.agent.protocol.sha256) {
    throw new Error('calibration governance checksum differs from the plan');
  }
  const governance = parseGovernance(governanceFile.value);
  if (governance.runner.executionCommit !== plan.runner.commit) {
    throw new Error('calibration governance execution commit differs from the plan');
  }
  const artifactCaches = new Set(plan.cells.map((cell) => cell.treatment.artifactCache));
  const sourceRoots = new Set(plan.cells.map((cell) => cell.treatment.sourceRoot));
  if (artifactCaches.size !== 1 || sourceRoots.size !== 1) {
    throw new Error('calibration plan has inconsistent repository roots');
  }
  const artifactCache = [...artifactCaches][0];
  const sourceRoot = [...sourceRoots][0];
  if (!artifactCache || !sourceRoot) throw new Error('calibration plan has no repository roots');
  const benchmarkRoot = await canonicalDirectory(path.resolve(artifactCache, '../../..'), 'calibration benchmark root');
  if (artifactCache !== path.join(benchmarkRoot, 'benchmark/evaluation/artifact-cache')) {
    throw new Error('calibration plan artifact cache does not identify the benchmark root');
  }
  await canonicalDirectory(sourceRoot, 'calibration source root');
  await assertGitExecutionSnapshot(benchmarkRoot, governance.runner.executionCommit);
  await assertGovernanceIdentities(benchmarkRoot, governance.runner.executionCommit, governance.identities);
  const packetIdentities = await assertPacketIdentitySnapshot(
    benchmarkRoot,
    governance.runner.executionCommit,
    governance.identities.packetLockSha256,
  );
  const candidatePath = path.join(benchmarkRoot, 'benchmark/calibration/e13/candidate-identities.json');
  const candidates = parseCandidates(JSON.parse(await readFile(candidatePath, 'utf8')) as unknown);
  await assertCandidateSourceSnapshot(sourceRoot, candidates);
  await assertExecutableIdentity(plan.agent.executable);
  const analysisPolicySha256 = packetIdentities.get('benchmark/calibration/e13/analysis-policy.json');
  if (!analysisPolicySha256) throw new Error('calibration packet omits the frozen analysis policy');
  return {
    benchmarkRoot,
    packetLockSha256: governance.identities.packetLockSha256,
    analysisPolicySha256,
  };
}

export async function assembleCalibrationEvaluationPlan(
  built: BuiltCalibrationPlanCore,
  authorization: { path: string; sha256: string },
): Promise<EvaluationPlan> {
  const authorizationFile = await readCanonicalJsonFile(authorization.path, 'calibration authorization');
  const authorizationPath = authorizationFile.path;
  assertSha256(authorization.sha256, 'calibration authorization sha256');
  if (authorizationFile.sha256 !== authorization.sha256) {
    throw new Error('calibration authorization checksum mismatch');
  }
  const plan: EvaluationPlan = {
    ...built.planCore,
    agent: { ...built.planCore.agent, authorization: { path: authorizationPath, sha256: authorization.sha256 } },
  };
  assertExactCalibrationEvaluationPlan(plan, built);
  const verified = await verifyCodexExecutionAuthorization(plan, built.environment.runDirectory);
  if (!verified || verified.limits.maxInvocations !== CALIBRATION_PLANNED_INVOCATIONS) {
    throw new Error('calibration authorization maximum invocation count must equal 18');
  }
  return plan;
}

export async function writeCalibrationEvaluationPlan(
  outputPath: string,
  built: BuiltCalibrationPlanCore,
  authorization: { path: string; sha256: string },
): Promise<EvaluationPlan> {
  const plan = await assembleCalibrationEvaluationPlan(built, authorization);
  const absolute = assertCanonicalAbsolutePath(outputPath, 'calibration plan output');
  await writeFile(absolute, canonicalJson(plan), { flag: 'wx' });
  await verifyCalibrationEvaluationPlanFile(absolute, built);
  return plan;
}

export async function verifyCalibrationEvaluationPlanFile(
  planPath: string,
  built: BuiltCalibrationPlanCore,
): Promise<EvaluationPlan> {
  const file = await readCanonicalJsonFile(planPath, 'calibration evaluation plan');
  const root = object(file.value, 'calibration evaluation plan');
  exactKeys(root, [
    'agent', 'cells', 'corpus', 'cumulativeJourneys', 'model', 'reasoningEffort',
    'runId', 'runner', 'sandbox', 'toolCatalogSha256', 'version',
  ], 'calibration evaluation plan');
  const agent = object(root.agent, 'calibration evaluation plan agent');
  exactKeys(agent, [
    'authorization', 'executable', 'kind', 'pricingPolicy', 'protocol', 'scope', 'toolPolicy',
  ], 'calibration evaluation plan agent');
  const authorization = contentIdentity(agent.authorization, 'calibration evaluation plan authorization');
  const expected = await assembleCalibrationEvaluationPlan(built, authorization);
  if (canonicalJson(file.value) !== canonicalJson(expected)) {
    throw new Error('calibration evaluation plan differs from the exact canonical plan');
  }
  return expected;
}

export function assertExactCalibrationEvaluationPlan(
  plan: EvaluationPlan,
  built: BuiltCalibrationPlanCore,
): void {
  validateEvaluationPlan(plan);
  assertExecutablePlanIdentity(plan, built);
  if (path.resolve(built.environment.benchmarkRoot, built.governance.run.relativeDirectory) !== built.environment.runDirectory) {
    throw new Error('calibration run directory differs from the exact environment binding');
  }
  if (codexExecutionPlanSha(plan) !== built.semanticSha256) {
    throw new Error('calibration semantic plan digest mismatch');
  }
  if (plan.agent.kind !== 'codex') throw new Error('calibration plan must use Codex');
  const expected = {
    ...built.planCore,
    agent: { ...built.planCore.agent, authorization: plan.agent.authorization },
  };
  if (canonicalJson(plan) !== canonicalJson(expected)) {
    throw new Error('calibration final plan field set or value mismatch');
  }
}

function assertExecutablePlanIdentity(
  plan: EvaluationPlan,
  built: BuiltCalibrationPlanCore,
): void {
  const { environment } = built;
  if (
    plan.runId !== HELD_OUT_CALIBRATION_RUN_ID ||
    plan.runner.repository !== 'harness-benchmark' ||
    plan.runner.commit !== built.governance.runner.executionCommit ||
    plan.agent.kind !== 'codex' || plan.agent.scope !== 'calibration'
  ) {
    throw new Error('executable calibration plan identity mismatch');
  }
  if (
    plan.model.declared !== MODEL || plan.model.provider !== 'openai' ||
    plan.model.resolved.status !== 'unknown' || plan.reasoningEffort !== 'max' ||
    plan.sandbox !== 'workspace-write' || plan.cumulativeJourneys.length !== 0 ||
    plan.cells.length !== CALIBRATION_PLANNED_INVOCATIONS
  ) {
    throw new Error('executable calibration model, sandbox, or call-count mismatch');
  }
  const expectedIds = Array.from(
    { length: CALIBRATION_PLANNED_INVOCATIONS },
    (_, index) => `C${String(index + 1).padStart(2, '0')}`,
  );
  if (plan.cells.some((cell, index) => cell.id !== expectedIds[index] || cell.order.position !== index)) {
    throw new Error('executable calibration cell IDs and positions must be exactly C01 through C18');
  }
  for (const cell of plan.cells) {
    const expectedProfile = cell.taskId === 'H01-config-precedence'
      ? 'bounded-defect-repair'
      : cell.taskId === 'H02-brownfield-script-merge'
        ? 'brownfield-ownership'
        : undefined;
    if (
      cell.mode !== 'atomic' || cell.dependencies.length !== 0 || !expectedProfile ||
      cell.timeoutSeconds !== HELD_OUT_CALIBRATION_TIMEOUT_SECONDS ||
      cell.treatment.profile !== expectedProfile || cell.treatment.platform !== HELD_OUT_CALIBRATION_PLATFORM ||
      cell.treatment.sourceRoot !== environment.sourceRoot ||
      cell.treatment.artifactCache !== environment.artifactCache
    ) {
      throw new Error(`executable calibration cell environment mismatch: ${cell.id}`);
    }
  }
}

function parseGovernance(value: unknown): CalibrationGovernanceInput {
  const root = object(value, 'calibration governance');
  exactKeys(root, ['agent', 'execution', 'identities', 'packetId', 'protocolId', 'run', 'runner', 'schemaVersion'], 'calibration governance');
  const runner = object(root.runner, 'calibration governance runner');
  const run = object(root.run, 'calibration governance run');
  const agent = object(root.agent, 'calibration governance agent');
  const execution = object(root.execution, 'calibration governance execution');
  const identities = object(root.identities, 'calibration governance identities');
  exactKeys(runner, ['executionCommit', 'qualifiedBaseCommit', 'repository'], 'calibration governance runner');
  exactKeys(run, ['concurrency', 'infrastructureFailureDisposition', 'relativeDirectory', 'retries', 'runId'], 'calibration governance run');
  exactKeys(agent, [
    'apiBillingAllowed', 'authentication', 'model', 'overageAllowed', 'provider',
    'purchasedCreditsAllowed', 'reasoningEffort', 'sandbox', 'scope',
  ], 'calibration governance agent');
  exactKeys(execution, ['cellTimeoutSeconds', 'plannedInvocations'], 'calibration governance execution');
  exactKeys(identities, [
    'atomicCatalogSha256', 'candidateIdentitiesSha256', 'corpusLockSha256',
    'packetLockSha256', 'scheduleSha256',
  ], 'calibration governance identities');
  for (const [name, digest] of Object.entries(identities)) assertSha256(digest, `calibration governance identities.${name}`);
  if (
    root.schemaVersion !== 1 || root.protocolId !== HELD_OUT_CALIBRATION_RUN_ID || root.packetId !== PACKET_ID ||
    runner.repository !== 'harness-benchmark' ||
    typeof runner.executionCommit !== 'string' || !/^[a-f0-9]{40}$/.test(runner.executionCommit) ||
    runner.qualifiedBaseCommit !== HELD_OUT_CALIBRATION_QUALIFIED_BASE_COMMIT ||
    run.runId !== HELD_OUT_CALIBRATION_RUN_ID || run.relativeDirectory !== HELD_OUT_CALIBRATION_RUN_DIRECTORY ||
    run.concurrency !== 1 || run.retries !== 0 ||
    run.infrastructureFailureDisposition !== 'invalidate-complete-calibration-packet' ||
    agent.scope !== 'calibration' || agent.authentication !== 'chatgpt-plan-only' || agent.model !== MODEL ||
    agent.provider !== 'openai' || agent.reasoningEffort !== 'max' || agent.sandbox !== 'workspace-write' ||
    agent.apiBillingAllowed !== false || agent.purchasedCreditsAllowed !== false || agent.overageAllowed !== false ||
    execution.plannedInvocations !== CALIBRATION_PLANNED_INVOCATIONS ||
    execution.cellTimeoutSeconds !== HELD_OUT_CALIBRATION_TIMEOUT_SECONDS
  ) {
    throw new Error('calibration governance fixed values mismatch');
  }
  return value as CalibrationGovernanceInput;
}

async function parseEnvironment(value: unknown): Promise<CalibrationEnvironmentBinding> {
  const root = object(value, 'calibration environment binding');
  exactKeys(root, [
    'artifactCache', 'benchmarkRoot', 'bindingId', 'executable', 'nodeRuntime',
    'platform', 'runDirectory', 'schemaVersion', 'sourceRoot',
  ], 'calibration environment binding');
  const executable = object(root.executable, 'calibration environment executable');
  exactKeys(executable, ['path', 'sha256', 'version'], 'calibration environment executable');
  if (
    root.schemaVersion !== 1 || typeof root.bindingId !== 'string' || root.bindingId.trim() === '' ||
    root.platform !== HELD_OUT_CALIBRATION_PLATFORM || typeof root.nodeRuntime !== 'string' || root.nodeRuntime.trim() === '' ||
    typeof executable.version !== 'string' || executable.version.trim() === ''
  ) {
    throw new Error('calibration environment binding values are invalid');
  }
  const benchmarkRoot = await canonicalDirectory(root.benchmarkRoot, 'calibration benchmark root');
  const sourceRoot = await canonicalDirectory(root.sourceRoot, 'calibration source root');
  const executablePath = await canonicalRegularFile(executable.path, 'calibration executable');
  const artifactCache = assertCanonicalAbsolutePath(root.artifactCache, 'calibration artifact cache');
  const runDirectory = assertCanonicalAbsolutePath(root.runDirectory, 'calibration run directory');
  if (artifactCache !== path.join(benchmarkRoot, 'benchmark/evaluation/artifact-cache')) {
    throw new Error('calibration artifact cache path mismatch');
  }
  if (runDirectory !== path.join(benchmarkRoot, HELD_OUT_CALIBRATION_RUN_DIRECTORY)) {
    throw new Error('calibration run directory path mismatch');
  }
  assertSha256(executable.sha256, 'calibration executable sha256');
  return {
    ...(value as CalibrationEnvironmentBinding), benchmarkRoot, sourceRoot,
    artifactCache, runDirectory,
    executable: { path: executablePath, sha256: executable.sha256, version: executable.version },
  };
}

function parsePricingPolicy(value: unknown): CodexPricingPolicy {
  const root = object(value, 'calibration pricing policy');
  exactKeys(root, ['effectiveDate', 'model', 'rates', 'schemaVersion', 'source', 'unit'], 'calibration pricing policy');
  const rates = object(root.rates, 'calibration pricing policy rates');
  exactKeys(rates, ['cachedInput', 'input', 'output'], 'calibration pricing policy rates');
  const validRate = (rate: unknown) => typeof rate === 'number' && Number.isFinite(rate) && rate >= 0;
  if (
    root.schemaVersion !== 1 || root.model !== MODEL || root.unit !== 'credits-per-million-tokens' ||
    typeof root.source !== 'string' || root.source.trim() === '' ||
    typeof root.effectiveDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(root.effectiveDate) ||
    !validRate(rates.input) || !validRate(rates.cachedInput) || !validRate(rates.output) ||
    (rates.cachedInput as number) > (rates.input as number)
  ) {
    throw new Error('calibration pricing policy is not runner-compatible v1');
  }
  return value as CodexPricingPolicy;
}

function parseToolPolicy(value: unknown, executableVersion: string): CodexToolPolicy {
  const root = object(value, 'calibration tool policy');
  exactKeys(root, [
    'allowedTools', 'codexVersion', 'featureOverrides', 'forbiddenCapabilities',
    'networkAccess', 'schemaVersion', 'webSearch',
  ], 'calibration tool policy');
  const features = object(root.featureOverrides, 'calibration tool policy feature overrides');
  exactKeys(features, DISABLED_FEATURES, 'calibration tool policy feature overrides');
  if (
    root.schemaVersion !== 1 || root.codexVersion !== executableVersion ||
    JSON.stringify(root.allowedTools) !== JSON.stringify(['shell', 'apply_patch']) ||
    JSON.stringify(root.forbiddenCapabilities) !== JSON.stringify(['connectors', 'mcp', 'subagents', 'browser', 'computer', 'image']) ||
    Object.values(features).some((enabled) => enabled !== false) ||
    root.webSearch !== 'disabled' || root.networkAccess !== false
  ) {
    throw new Error('calibration tool policy is not runner-compatible v1');
  }
  return value as CodexToolPolicy;
}

async function assertGovernanceIdentities(
  benchmarkRoot: string,
  executionCommit: string,
  identities: CalibrationGovernanceInput['identities'],
): Promise<void> {
  const files: Array<[keyof typeof identities, string]> = [
    ['packetLockSha256', 'benchmark/calibration/e13/packet-lock.json'],
    ['scheduleSha256', 'benchmark/calibration/e13/schedule.json'],
    ['corpusLockSha256', 'benchmark/calibration/e13/corpus/corpus-lock.json'],
    ['atomicCatalogSha256', 'benchmark/calibration/e13/corpus/atomic-catalog.json'],
    ['candidateIdentitiesSha256', 'benchmark/calibration/e13/candidate-identities.json'],
  ];
  for (const [key, relative] of files) {
    await assertFileSha(path.join(benchmarkRoot, relative), identities[key], `calibration governance ${key}`);
    if (sha256(await gitBlob(benchmarkRoot, executionCommit, relative)) !== identities[key]) {
      throw new Error(`calibration governance ${key} differs from the execution commit`);
    }
  }
}

async function assertPacketIdentitySnapshot(
  benchmarkRoot: string,
  executionCommit: string,
  packetLockSha256: string,
): Promise<Map<string, string>> {
  const packetPath = path.join(benchmarkRoot, 'benchmark/calibration/e13/packet-lock.json');
  await assertFileSha(packetPath, packetLockSha256, 'calibration packet lock');
  const packet = object(JSON.parse(await readFile(packetPath, 'utf8')) as unknown, 'calibration packet lock');
  if (packet.schemaVersion !== 1 || packet.packetId !== PACKET_ID || !Array.isArray(packet.identities)) {
    throw new Error('calibration packet lock identity header is invalid');
  }
  const seen = new Set<string>();
  const identities = packet.identities.map((item, index) => {
    const identity = object(item, `calibration packet identity ${index}`);
    exactKeys(identity, ['path', 'sha256'], `calibration packet identity ${index}`);
    const relative = safeRepositoryRelativePath(identity.path, `calibration packet identity ${index} path`);
    assertSha256(identity.sha256, `calibration packet identity ${index} sha256`);
    if (seen.has(relative)) throw new Error(`calibration packet identity is duplicated: ${relative}`);
    seen.add(relative);
    return { path: relative, sha256: identity.sha256 };
  });
  for (const required of CALIBRATION_EXECUTION_ARTIFACTS) {
    if (required !== 'benchmark/calibration/e13/packet-lock.json' && !seen.has(required)) {
      throw new Error(`calibration packet omits execution artifact: ${required}`);
    }
  }
  for (const identity of identities) {
    await assertFileSha(
      path.join(benchmarkRoot, identity.path),
      identity.sha256,
      `calibration packet identity ${identity.path}`,
    );
  }
  try {
    await execFile('git', [
      'diff', '--quiet', '--no-ext-diff', executionCommit, '--',
      ...identities.map((identity) => identity.path),
    ], { cwd: benchmarkRoot });
  } catch (error) {
    throw new Error(`calibration packet live identities differ from the execution commit: ${message(error)}`);
  }
  return new Map(identities.map((identity) => [identity.path, identity.sha256]));
}

async function assertGitExecutionSnapshot(benchmarkRoot: string, executionCommit: string): Promise<void> {
  try {
    await execFile('git', [
      'merge-base', '--is-ancestor',
      HELD_OUT_CALIBRATION_QUALIFIED_BASE_COMMIT,
      executionCommit,
    ], { cwd: benchmarkRoot });
    const { stdout } = await execFile('git', ['rev-parse', `${executionCommit}^{commit}`], { cwd: benchmarkRoot });
    if (stdout.trim() !== executionCommit) throw new Error('execution commit did not resolve exactly');
    for (const relative of CALIBRATION_EXECUTION_ARTIFACTS) {
      const committed = await gitBlob(benchmarkRoot, executionCommit, relative);
      const live = await readFile(path.join(benchmarkRoot, relative));
      if (sha256(committed) !== sha256(live)) {
        throw new Error(`live execution artifact differs from commit: ${relative}`);
      }
    }
  } catch (error) {
    throw new Error(`calibration execution commit snapshot is invalid: ${message(error)}`);
  }
}

function gitBlob(repository: string, commit: string, relative: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    execFileCallback(
      'git', ['show', `${commit}:${relative}`],
      { cwd: repository, encoding: 'buffer', maxBuffer: 16 * 1024 * 1024 },
      (error, stdout) => error ? reject(error) : resolve(stdout),
    );
  });
}

async function assertExecutableIdentity(executable: CalibrationEnvironmentBinding['executable']): Promise<void> {
  await assertFileSha(executable.path, executable.sha256, 'calibration executable');
}

function parseCandidates(value: unknown): {
  sourceCommit: string;
  manifestRoot: string;
  treatments: Array<{ id: string; file: string; sha256: string }>;
} {
  const root = object(value, 'calibration candidate identities');
  exactKeys(root, ['manifestRoot', 'schemaVersion', 'sourceCommit', 'sourceRepository', 'treatments'], 'calibration candidate identities');
  if (
    root.schemaVersion !== 1 || root.sourceRepository !== 'repository-harness' ||
    typeof root.sourceCommit !== 'string' || !/^[a-f0-9]{40}$/.test(root.sourceCommit) ||
    typeof root.manifestRoot !== 'string' || !Array.isArray(root.treatments)
  ) {
    throw new Error('calibration candidate identities are invalid');
  }
  const treatments = root.treatments.map((item, index) => {
    const treatment = object(item, `calibration treatment ${index}`);
    exactKeys(treatment, ['file', 'id', 'sha256'], `calibration treatment ${index}`);
    if (typeof treatment.id !== 'string' || typeof treatment.file !== 'string') throw new Error('calibration treatment identity is invalid');
    safeRepositoryRelativePath(treatment.file, `calibration treatment ${index} file`);
    assertSha256(treatment.sha256, `calibration treatment ${index} sha256`);
    return { id: treatment.id, file: treatment.file, sha256: treatment.sha256 };
  });
  if (treatments.map(({ id }) => id).join(',') !== 'FULL_V0,COPY_ONCE,MODULAR_CORE') {
    throw new Error('calibration treatment order mismatch');
  }
  return { sourceCommit: root.sourceCommit, manifestRoot: root.manifestRoot, treatments };
}

async function assertCandidateSourceSnapshot(
  sourceRoot: string,
  candidates: ReturnType<typeof parseCandidates>,
): Promise<void> {
  const manifestRoot = safeRepositoryRelativePath(candidates.manifestRoot, 'calibration candidate manifest root');
  try {
    const { stdout } = await execFile('git', ['rev-parse', `${candidates.sourceCommit}^{commit}`], { cwd: sourceRoot });
    if (stdout.trim() !== candidates.sourceCommit) throw new Error('candidate source commit did not resolve exactly');
    for (const treatment of candidates.treatments) {
      const relative = safeRepositoryRelativePath(
        path.posix.join(manifestRoot, treatment.file),
        `calibration candidate ${treatment.id} path`,
      );
      await assertFileSha(path.join(sourceRoot, relative), treatment.sha256, `calibration candidate ${treatment.id}`);
      if (sha256(await gitBlob(sourceRoot, candidates.sourceCommit, relative)) !== treatment.sha256) {
        throw new Error(`calibration candidate ${treatment.id} differs from the source commit`);
      }
    }
  } catch (error) {
    throw new Error(`calibration candidate source snapshot is invalid: ${message(error)}`);
  }
}

function parseSchedule(value: unknown): {
  calls: Array<{ callId: string; taskId: string; repetition: number; treatment: string }>;
} {
  const root = object(value, 'calibration schedule');
  if (
    root.schemaVersion !== 1 || root.plannedCalls !== CALIBRATION_PLANNED_INVOCATIONS ||
    root.concurrency !== 1 || root.retries !== 0 || !Array.isArray(root.calls)
  ) {
    throw new Error('calibration schedule header mismatch');
  }
  const calls = root.calls.map((item, index) => {
    const call = object(item, `calibration schedule call ${index}`);
    exactKeys(call, ['blockId', 'callId', 'localPosition', 'repetition', 'taskId', 'treatment'], `calibration schedule call ${index}`);
    if (
      call.callId !== `C${String(index + 1).padStart(2, '0')}` || typeof call.taskId !== 'string' ||
      !Number.isInteger(call.repetition) || typeof call.treatment !== 'string'
    ) {
      throw new Error(`calibration schedule call identity mismatch: ${index}`);
    }
    return {
      callId: call.callId as string,
      taskId: call.taskId,
      repetition: call.repetition as number,
      treatment: call.treatment,
    };
  });
  return { calls };
}

function parseCorpusLock(value: unknown): { atomicCatalogSha256: string } {
  const root = object(value, 'calibration corpus lock');
  if (root.schemaVersion !== 1 || root.corpusId !== PACKET_ID || root.decisionCorpusEligible !== false) {
    throw new Error('calibration corpus lock identity mismatch');
  }
  assertSha256(root.atomicCatalogSha256, 'calibration corpus atomic catalog sha256');
  return { atomicCatalogSha256: root.atomicCatalogSha256 };
}

async function readCanonicalJsonFile(filePath: string, label: string): Promise<{ path: string; sha256: string; value: unknown }> {
  const canonicalPath = await canonicalRegularFile(filePath, label);
  const bytes = await readFile(canonicalPath);
  let value: unknown;
  try {
    value = JSON.parse(bytes.toString('utf8')) as unknown;
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${message(error)}`);
  }
  if (bytes.toString('utf8') !== canonicalJson(value)) throw new Error(`${label} is not canonical JSON`);
  return { path: canonicalPath, sha256: sha256(bytes), value };
}

async function canonicalDirectory(value: unknown, label: string): Promise<string> {
  const absolute = assertCanonicalAbsolutePath(value, label);
  const details = await lstat(absolute);
  if (!details.isDirectory() || details.isSymbolicLink()) throw new Error(`${label} must be a non-symbolic-link directory`);
  if (await realpath(absolute) !== absolute) throw new Error(`${label} must be its canonical real path`);
  return absolute;
}

async function canonicalRegularFile(value: unknown, label: string): Promise<string> {
  const absolute = assertCanonicalAbsolutePath(value, label);
  const details = await lstat(absolute);
  if (!details.isFile() || details.isSymbolicLink()) throw new Error(`${label} must be a regular non-symbolic-link file`);
  if (await realpath(absolute) !== absolute) throw new Error(`${label} must be its canonical real path`);
  return absolute;
}

function assertCanonicalAbsolutePath(value: unknown, label: string): string {
  if (typeof value !== 'string' || !path.isAbsolute(value) || path.resolve(value) !== value) {
    throw new Error(`${label} must be a canonical absolute path`);
  }
  return value;
}

function safeRepositoryRelativePath(value: unknown, label: string): string {
  if (
    typeof value !== 'string' || value === '' || value.includes('\\') || path.posix.isAbsolute(value) ||
    path.posix.normalize(value) !== value || value === '.' || value.startsWith('../')
  ) {
    throw new Error(`${label} must be a normalized repository-relative path`);
  }
  return value;
}

async function assertFileSha(filePath: string, expected: string, label: string): Promise<void> {
  const bytes = await readFile(filePath);
  if (sha256(bytes) !== expected) throw new Error(`${label} checksum mismatch`);
}

function contentIdentity(value: unknown, label: string): { path: string; sha256: string } {
  const root = object(value, label);
  exactKeys(root, ['path', 'sha256'], label);
  if (typeof root.path !== 'string') throw new Error(`${label}.path is required`);
  assertSha256(root.sha256, `${label}.sha256`);
  return { path: root.path, sha256: root.sha256 };
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, expected: string[], label: string): void {
  if (Object.keys(value).sort().join('\0') !== [...expected].sort().join('\0')) {
    throw new Error(`${label} field set mismatch`);
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
