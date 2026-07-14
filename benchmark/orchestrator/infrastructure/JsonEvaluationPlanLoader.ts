import { readFile } from 'node:fs/promises';
import {
  validateEvaluationPlan,
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
    const agent = object(root.agent, 'agent');
    if (agent.kind !== 'fake') throw new Error('Phase 0 qualification accepts fake agents only');
    assertNonEmpty(agent.command, 'agent.command');
    const model = object(root.model, 'model');
    assertNonEmpty(model.declared, 'model.declared');
    assertNonEmpty(model.provider, 'model.provider');
    assertNonEmpty(model.runtime, 'model.runtime');
    assertNonEmpty(root.sandbox, 'sandbox');
    assertSha256(root.toolCatalogSha256, 'toolCatalogSha256');
    const corpus = object(root.corpus, 'corpus');
    assertNonEmpty(corpus.root, 'corpus.root');
    assertSha256(corpus.lockSha256, 'corpus.lockSha256');
    assertSha256(corpus.atomicCatalogSha256, 'corpus.atomicCatalogSha256');
    if (!Array.isArray(root.cells)) throw new Error('cells must be an array');
    const plan: EvaluationPlan = {
      version: 1,
      runId: root.runId,
      runner: { repository: runner.repository, commit: runner.commit },
      agent: {
        kind: 'fake',
        command: agent.command,
        args: stringArray(agent.args, 'agent.args'),
      },
      model: {
        declared: model.declared,
        provider: model.provider,
        runtime: model.runtime,
        resolved: knownOrUnknown(model.resolved, 'model.resolved'),
      },
      sandbox: root.sandbox,
      toolCatalogSha256: root.toolCatalogSha256,
      corpus: {
        root: corpus.root,
        lockSha256: corpus.lockSha256,
        atomicCatalogSha256: corpus.atomicCatalogSha256,
      },
      cells: root.cells.map((cell, index) => parseCell(cell, index)),
    };
    validateEvaluationPlan(plan);
    return plan;
  }
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
