import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  validateEvaluationPlan,
  type CumulativeJourneySpec,
  type EvaluationCellSpec,
  type EvaluationPlan,
  type KnownOrUnknown,
} from '../domain/evaluation';
import { assertNonEmpty, assertSha256 } from './EvaluationFiles';

export class JsonEvaluationPlanLoader {
  async load(planPath: string): Promise<EvaluationPlan> {
    let value: unknown;
    try {
      value = JSON.parse(await readFile(planPath, 'utf8')) as unknown;
    } catch (error) {
      throw new Error(`cannot read evaluation plan ${planPath}: ${message(error)}`);
    }
    const root = object(value, 'evaluation plan');
    if (root.version !== 1) throw new Error(`unsupported evaluation plan version: ${String(root.version)}`);
    assertNonEmpty(root.runId, 'runId');
    const runner = object(root.runner, 'runner');
    assertNonEmpty(runner.repository, 'runner.repository');
    assertNonEmpty(runner.commit, 'runner.commit');
    const agent = parseAgent(root.agent);
    const model = object(root.model, 'model');
    assertNonEmpty(model.declared, 'model.declared');
    assertNonEmpty(model.provider, 'model.provider');
    assertNonEmpty(model.runtime, 'model.runtime');
    const reasoningEffort = root.reasoningEffort === undefined && agent.kind === 'fake'
      ? 'not-applicable'
      : requiredString(root.reasoningEffort, 'reasoningEffort');
    assertNonEmpty(root.sandbox, 'sandbox');
    assertSha256(root.toolCatalogSha256, 'toolCatalogSha256');
    const corpus = object(root.corpus, 'corpus');
    assertNonEmpty(corpus.root, 'corpus.root');
    assertSha256(corpus.lockSha256, 'corpus.lockSha256');
    assertSha256(corpus.atomicCatalogSha256, 'corpus.atomicCatalogSha256');
    const cells = root.cells === undefined ? [] : root.cells;
    const cumulativeJourneys = root.cumulativeJourneys === undefined ? [] : root.cumulativeJourneys;
    if (!Array.isArray(cells)) throw new Error('cells must be an array');
    if (!Array.isArray(cumulativeJourneys)) throw new Error('cumulativeJourneys must be an array');
    if (cumulativeJourneys.length > 0) {
      assertSha256(corpus.cumulativeCatalogSha256, 'corpus.cumulativeCatalogSha256');
    }
    const plan: EvaluationPlan = {
      version: 1,
      runId: root.runId,
      runner: { repository: runner.repository, commit: runner.commit },
      agent,
      model: {
        declared: model.declared,
        provider: model.provider,
        runtime: model.runtime,
        resolved: knownOrUnknown(model.resolved, 'model.resolved'),
      },
      reasoningEffort,
      sandbox: root.sandbox,
      toolCatalogSha256: root.toolCatalogSha256,
      corpus: {
        root: corpus.root,
        lockSha256: corpus.lockSha256,
        atomicCatalogSha256: corpus.atomicCatalogSha256,
        cumulativeCatalogSha256:
          corpus.cumulativeCatalogSha256 === undefined
            ? undefined
            : requiredString(corpus.cumulativeCatalogSha256, 'corpus.cumulativeCatalogSha256'),
      },
      cells: cells.map((cell, index) => parseCell(cell, index)),
      cumulativeJourneys: cumulativeJourneys.map((journey, index) => parseJourney(journey, index)),
    };
    validateEvaluationPlan(plan);
    return plan;
  }
}

function parseAgent(value: unknown): EvaluationPlan['agent'] {
  const agent = object(value, 'agent');
  if (agent.kind === 'fake') {
    assertNonEmpty(agent.command, 'agent.command');
    return { kind: 'fake', command: agent.command, args: stringArray(agent.args, 'agent.args') };
  }
  if (agent.kind === 'codex') {
    const executable = content(agent.executable, 'agent.executable');
    const identity = object(agent.executable, 'agent.executable');
    if (!path.isAbsolute(executable.path)) throw new Error('agent.executable.path must be absolute');
    if (agent.scope !== 'calibration' && agent.scope !== 'decision') {
      throw new Error('agent.scope must be calibration or decision');
    }
    const authorization = content(agent.authorization, 'agent.authorization');
    const protocol = content(agent.protocol, 'agent.protocol');
    const pricingPolicy = content(agent.pricingPolicy, 'agent.pricingPolicy');
    const toolPolicy = content(agent.toolPolicy, 'agent.toolPolicy');
    for (const [label, identity] of [
      ['agent.authorization', authorization],
      ['agent.protocol', protocol],
      ['agent.pricingPolicy', pricingPolicy],
      ['agent.toolPolicy', toolPolicy],
    ] as const) {
      if (!path.isAbsolute(identity.path)) throw new Error(`${label}.path must be absolute`);
    }
    return {
      kind: 'codex',
      executable: {
        ...executable,
        version: requiredString(identity.version, 'agent.executable.version'),
      },
      scope: agent.scope,
      authorization,
      protocol,
      pricingPolicy,
      toolPolicy,
    };
  }
  throw new Error('agent.kind must be fake or codex');
}

function parseCell(value: unknown, index: number): EvaluationCellSpec {
  const cell = object(value, `cells[${index}]`);
  assertNonEmpty(cell.id, `cells[${index}].id`);
  assertNonEmpty(cell.taskId, `cells[${index}].taskId`);
  if (cell.mode !== 'atomic' && cell.mode !== 'cumulative') {
    throw new Error(`cells[${index}].mode must be atomic or cumulative`);
  }
  const treatmentValue = object(cell.treatment, `cells[${index}].treatment`);
  const treatmentContent = content(treatmentValue, `cells[${index}].treatment`);
  assertNonEmpty(treatmentValue.sourceRoot, `cells[${index}].treatment.sourceRoot`);
  assertNonEmpty(treatmentValue.profile, `cells[${index}].treatment.profile`);
  assertNonEmpty(treatmentValue.platform, `cells[${index}].treatment.platform`);
  const timeoutSeconds = number(cell.timeoutSeconds, `cells[${index}].timeoutSeconds`);
  if (timeoutSeconds <= 0) throw new Error(`cells[${index}].timeoutSeconds must be positive`);
  const order = object(cell.order, `cells[${index}].order`);
  return {
    id: cell.id,
    taskId: cell.taskId,
    mode: cell.mode,
    dependencies: stringArray(cell.dependencies, `cells[${index}].dependencies`),
    treatment: {
      ...treatmentContent,
      sourceRoot: treatmentValue.sourceRoot,
      profile: treatmentValue.profile,
      platform: treatmentValue.platform,
      artifactCache:
        treatmentValue.artifactCache === undefined
          ? undefined
          : requiredString(treatmentValue.artifactCache, `cells[${index}].treatment.artifactCache`),
    },
    timeoutSeconds,
    order: {
      repetition: integer(order.repetition, `cells[${index}].order.repetition`),
      position: integer(order.position, `cells[${index}].order.position`),
    },
  };
}

function parseJourney(value: unknown, index: number): CumulativeJourneySpec {
  const journey = object(value, `cumulativeJourneys[${index}]`);
  assertNonEmpty(journey.id, `cumulativeJourneys[${index}].id`);
  assertNonEmpty(journey.journeyId, `cumulativeJourneys[${index}].journeyId`);
  const treatmentValue = object(journey.treatment, `cumulativeJourneys[${index}].treatment`);
  const treatmentContent = content(treatmentValue, `cumulativeJourneys[${index}].treatment`);
  assertNonEmpty(treatmentValue.sourceRoot, `cumulativeJourneys[${index}].treatment.sourceRoot`);
  assertNonEmpty(treatmentValue.profile, `cumulativeJourneys[${index}].treatment.profile`);
  assertNonEmpty(treatmentValue.platform, `cumulativeJourneys[${index}].treatment.platform`);
  const timeoutSeconds = number(journey.timeoutSeconds, `cumulativeJourneys[${index}].timeoutSeconds`);
  if (timeoutSeconds <= 0) throw new Error(`cumulativeJourneys[${index}].timeoutSeconds must be positive`);
  const order = object(journey.order, `cumulativeJourneys[${index}].order`);
  return {
    id: journey.id,
    journeyId: journey.journeyId,
    treatment: {
      ...treatmentContent,
      sourceRoot: treatmentValue.sourceRoot,
      profile: treatmentValue.profile,
      platform: treatmentValue.platform,
      artifactCache: treatmentValue.artifactCache === undefined
        ? undefined
        : requiredString(treatmentValue.artifactCache, `cumulativeJourneys[${index}].treatment.artifactCache`),
    },
    timeoutSeconds,
    order: {
      repetition: integer(order.repetition, `cumulativeJourneys[${index}].order.repetition`),
      position: integer(order.position, `cumulativeJourneys[${index}].order.position`),
    },
  };
}

function content(value: unknown, label: string): { path: string; sha256: string } {
  const parsed = object(value, label);
  assertNonEmpty(parsed.path, `${label}.path`);
  assertSha256(parsed.sha256, `${label}.sha256`);
  return { path: parsed.path, sha256: parsed.sha256 };
}

function knownOrUnknown<T = string>(value: unknown, label: string): KnownOrUnknown<T> {
  const parsed = object(value, label);
  if (parsed.status === 'known') {
    assertNonEmpty(parsed.value, `${label}.value`);
    return { status: 'known', value: parsed.value as T };
  }
  if (parsed.status === 'unknown') {
    assertNonEmpty(parsed.reason, `${label}.reason`);
    return { status: 'unknown', reason: parsed.reason };
  }
  throw new Error(`${label}.status must be known or unknown`);
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function stringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string' && item !== '')) {
    throw new Error(`${label} must be an array of non-empty strings`);
  }
  return value;
}

function number(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${label} must be a number`);
  return value;
}

function integer(value: unknown, label: string): number {
  const parsed = number(value, label);
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error(`${label} must be a non-negative integer`);
  return parsed;
}

function requiredString(value: unknown, label: string): string {
  assertNonEmpty(value, label);
  return value;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
