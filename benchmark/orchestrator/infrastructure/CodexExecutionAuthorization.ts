import { lstat, readFile, realpath } from 'node:fs/promises';
import { evaluationPlanSemanticSha256, type EvaluationPlan } from '../domain/evaluation';
import { sha256 } from './EvaluationFiles';

const AUTHORIZATION_KEYS = [
  'acceptsPossibleOneAdmittedCallCreditOvershoot', 'approvedAt', 'approver', 'approverRole', 'authorizesApiBilling',
  'authorizesCalibration', 'authorizesLiveExecution', 'authorizesOverage',
  'authorizesPurchasedCredits', 'authorizesUS110', 'executableSha', 'gate',
  'maxElapsedSeconds', 'maxInvocations', 'maxPlanCredits', 'model', 'openBlockers',
  'authMode', 'perInvocationCreditReserve',
  'pricingPolicySha', 'protocolId', 'protocolSha', 'reasoningEffort', 'runId',
  'executionPlanSha', 'runDirectory', 'schemaVersion', 'scope', 'state', 'statement',
  'toolPolicySha',
].sort();

const DISABLED_FEATURES = [
  'apps', 'auth_elicitation', 'browser_use', 'browser_use_external',
  'browser_use_full_cdp_access', 'computer_use', 'enable_fanout', 'enable_mcp_apps',
  'goals', 'image_generation', 'in_app_browser', 'multi_agent', 'plugins',
  'remote_plugin', 'skill_mcp_dependency_install', 'tool_call_mcp_elicitation',
].sort();

export interface CodexPricingPolicy {
  schemaVersion: 1;
  model: string;
  unit: 'credits-per-million-tokens';
  rates: { input: number; cachedInput: number; output: number };
  source: string;
  effectiveDate: string;
}

export interface VerifiedCodexExecutionAuthorization {
  pricing: CodexPricingPolicy;
  toolPolicy: CodexToolPolicy;
  limits: {
    maxInvocations: number;
    maxPlanCredits: number;
    maxElapsedSeconds: number;
    perInvocationCreditReserve: number;
  };
}

export interface CodexToolPolicy {
  schemaVersion: 1;
  codexVersion: string;
  allowedTools: ['shell', 'apply_patch'];
  forbiddenCapabilities: ['connectors', 'mcp', 'subagents', 'browser', 'computer', 'image'];
  featureOverrides: Record<string, false>;
  webSearch: 'disabled';
  networkAccess: false;
}

export async function verifyCodexExecutionAuthorization(
  plan: EvaluationPlan,
  runDirectory: string,
): Promise<VerifiedCodexExecutionAuthorization | undefined> {
  if (plan.agent.kind !== 'codex') return undefined;
  const authorizationBytes = await regularFileBytes(plan.agent.authorization.path, 'Codex authorization');
  if (sha256(authorizationBytes) !== plan.agent.authorization.sha256) {
    throw new Error('Codex authorization checksum mismatch');
  }
  const protocolBytes = await regularFileBytes(plan.agent.protocol.path, 'Codex protocol');
  if (sha256(protocolBytes) !== plan.agent.protocol.sha256) {
    throw new Error('Codex protocol checksum mismatch');
  }
  const protocol = parseObject(protocolBytes, 'Codex protocol');
  if (typeof protocol.protocolId !== 'string' || protocol.protocolId === '') {
    throw new Error('Codex protocol has no protocolId');
  }
  const pricingBytes = await regularFileBytes(plan.agent.pricingPolicy.path, 'Codex pricing policy');
  if (sha256(pricingBytes) !== plan.agent.pricingPolicy.sha256) {
    throw new Error('Codex pricing policy checksum mismatch');
  }
  const pricing = parsePricingPolicy(pricingBytes);
  if (pricing.model !== plan.model.declared) throw new Error('Codex pricing policy model mismatch');
  const toolPolicyBytes = await regularFileBytes(plan.agent.toolPolicy.path, 'Codex tool policy');
  const toolPolicySha = sha256(toolPolicyBytes);
  if (
    toolPolicySha !== plan.agent.toolPolicy.sha256 ||
    toolPolicySha !== plan.toolCatalogSha256
  ) {
    throw new Error('Codex tool policy checksum or catalog identity mismatch');
  }
  const toolPolicy = parseToolPolicy(toolPolicyBytes, plan.agent.executable.version);
  const authorization = parseObject(authorizationBytes, 'Codex authorization');
  if (Object.keys(authorization).sort().join('\0') !== AUTHORIZATION_KEYS.join('\0')) {
    throw new Error('Codex authorization field set mismatch');
  }
  const calibration = plan.agent.scope === 'calibration';
  const exact = {
    schemaVersion: 1,
    gate: calibration ? 'D0' : 'D',
    protocolId: protocol.protocolId,
    protocolSha: plan.agent.protocol.sha256,
    state: 'approved',
    runId: plan.runId,
    scope: plan.agent.scope,
    model: plan.model.declared,
    reasoningEffort: plan.reasoningEffort,
    executableSha: plan.agent.executable.sha256,
    pricingPolicySha: plan.agent.pricingPolicy.sha256,
    authMode: 'chatgpt',
    authorizesLiveExecution: true,
    authorizesCalibration: calibration,
    authorizesUS110: !calibration,
    authorizesApiBilling: false,
    authorizesPurchasedCredits: false,
    authorizesOverage: false,
    acceptsPossibleOneAdmittedCallCreditOvershoot: true,
    toolPolicySha,
    executionPlanSha: codexExecutionPlanSha(plan),
    runDirectory,
  } as const;
  for (const [key, expected] of Object.entries(exact)) {
    if (authorization[key] !== expected) throw new Error(`Codex authorization ${key} mismatch`);
  }
  if (
    typeof authorization.approver !== 'string' || authorization.approver.trim() === '' ||
    typeof authorization.approverRole !== 'string' || authorization.approverRole.trim() === '' ||
    typeof authorization.statement !== 'string' || authorization.statement.trim() === '' ||
    typeof authorization.approvedAt !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(authorization.approvedAt) ||
    Number.isNaN(Date.parse(authorization.approvedAt)) ||
    !Array.isArray(authorization.openBlockers) || authorization.openBlockers.length !== 0 ||
    !positiveInteger(authorization.maxInvocations) ||
    !positiveNumber(authorization.maxPlanCredits) ||
    !positiveInteger(authorization.maxElapsedSeconds) ||
    !positiveNumber(authorization.perInvocationCreditReserve) ||
    authorization.perInvocationCreditReserve > authorization.maxPlanCredits
  ) {
    throw new Error('Codex authorization approval or limit fields are invalid');
  }
  return {
    pricing,
    toolPolicy,
    limits: {
      maxInvocations: authorization.maxInvocations as number,
      maxPlanCredits: authorization.maxPlanCredits as number,
      maxElapsedSeconds: authorization.maxElapsedSeconds as number,
      perInvocationCreditReserve: authorization.perInvocationCreditReserve as number,
    },
  };
}

export function codexExecutionPlanSha(plan: EvaluationPlan): string {
  return evaluationPlanSemanticSha256(plan);
}

function parseToolPolicy(bytes: Buffer, codexVersion: string): CodexToolPolicy {
  const value = parseObject(bytes, 'Codex tool policy');
  const expectedKeys = [
    'allowedTools', 'codexVersion', 'featureOverrides', 'forbiddenCapabilities',
    'networkAccess', 'schemaVersion', 'webSearch',
  ].sort();
  if (Object.keys(value).sort().join('\0') !== expectedKeys.join('\0')) {
    throw new Error('Codex tool policy field set mismatch');
  }
  const features = value.featureOverrides;
  if (!features || typeof features !== 'object' || Array.isArray(features)) {
    throw new Error('Codex tool policy featureOverrides must be an object');
  }
  const featureRecord = features as Record<string, unknown>;
  if (
    Object.keys(featureRecord).sort().join('\0') !== DISABLED_FEATURES.join('\0') ||
    Object.values(featureRecord).some((enabled) => enabled !== false) ||
    value.schemaVersion !== 1 || value.codexVersion !== codexVersion ||
    JSON.stringify(value.allowedTools) !== JSON.stringify(['shell', 'apply_patch']) ||
    JSON.stringify(value.forbiddenCapabilities) !==
      JSON.stringify(['connectors', 'mcp', 'subagents', 'browser', 'computer', 'image']) ||
    value.webSearch !== 'disabled' || value.networkAccess !== false
  ) {
    throw new Error('Codex tool policy values are invalid');
  }
  return value as unknown as CodexToolPolicy;
}

function parsePricingPolicy(bytes: Buffer): CodexPricingPolicy {
  const value = parseObject(bytes, 'Codex pricing policy');
  const expectedKeys = ['effectiveDate', 'model', 'rates', 'schemaVersion', 'source', 'unit'];
  if (Object.keys(value).sort().join('\0') !== expectedKeys.sort().join('\0')) {
    throw new Error('Codex pricing policy field set mismatch');
  }
  const rates = value.rates;
  if (!rates || typeof rates !== 'object' || Array.isArray(rates)) {
    throw new Error('Codex pricing policy rates must be an object');
  }
  const rateRecord = rates as Record<string, unknown>;
  if (Object.keys(rateRecord).sort().join('\0') !== ['cachedInput', 'input', 'output'].sort().join('\0')) {
    throw new Error('Codex pricing policy rate field set mismatch');
  }
  if (
    value.schemaVersion !== 1 || value.unit !== 'credits-per-million-tokens' ||
    typeof value.model !== 'string' || value.model === '' ||
    typeof value.source !== 'string' || value.source === '' ||
    typeof value.effectiveDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value.effectiveDate) ||
    !validRate(rateRecord.input) || !validRate(rateRecord.cachedInput) || !validRate(rateRecord.output) ||
    (rateRecord.cachedInput as number) > (rateRecord.input as number)
  ) {
    throw new Error('Codex pricing policy values are invalid');
  }
  return value as unknown as CodexPricingPolicy;
}

function parseObject(bytes: Buffer, label: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(bytes.toString('utf8')) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
    return parsed as Record<string, unknown>;
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${message(error)}`);
  }
}

async function regularFileBytes(filePath: string, label: string): Promise<Buffer> {
  let details;
  try {
    details = await lstat(filePath);
  } catch (error) {
    throw new Error(`${label} file is unavailable: ${message(error)}`);
  }
  if (!details.isFile() || details.isSymbolicLink()) {
    throw new Error(`${label} must be a regular non-symbolic-link file`);
  }
  if ((await realpath(filePath)) !== filePath) {
    throw new Error(`${label} path must already be its canonical real path`);
  }
  return readFile(filePath);
}

function validRate(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function positiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

function positiveNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
