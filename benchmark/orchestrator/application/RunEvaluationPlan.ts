import { createHash } from 'node:crypto';
import type { EvaluationPlan, RawCellRecord } from '../domain/evaluation';
import { validateEvaluationPlan } from '../domain/evaluation';
import type { EvaluationRubricEvaluator } from '../ports/EvaluationRubricEvaluator';
import type { RawCellStore } from '../ports/RawCellStore';
import type { RunEvaluationCell } from './RunEvaluationCell';

const EMPTY_SHA256 = sha256('');

export class RunEvaluationPlan {
  constructor(
    private readonly runCell: RunEvaluationCell,
    private readonly rubric: EvaluationRubricEvaluator,
    private readonly store: RawCellStore,
  ) {}

  async execute(plan: EvaluationPlan): Promise<RawCellRecord[]> {
    validateEvaluationPlan(plan);
    const records: RawCellRecord[] = [];
    const byId = new Map<string, RawCellRecord>();
    for (const cell of plan.cells) {
      const blockedBy = cell.dependencies.filter((dependency) => byId.get(dependency)?.status !== 'passed');
      const record = blockedBy.length > 0
        ? await this.blockedRecord(plan, cell, blockedBy)
        : await this.runCell.execute(plan, cell);
      records.push(record);
      byId.set(cell.id, record);
    }
    return records;
  }

  private async blockedRecord(
    plan: EvaluationPlan,
    cell: EvaluationPlan['cells'][number],
    blockedBy: string[],
  ): Promise<RawCellRecord> {
    const loaded = await this.rubric.load(cell, plan.corpus.root);
    const record: RawCellRecord = {
      version: 1,
      runId: plan.runId,
      cellId: cell.id,
      mode: cell.mode,
      dependencies: [...cell.dependencies],
      status: 'blocked_dependency',
      blockedBy,
      identities: {
        runner: plan.runner,
        fixture: {
          taskId: loaded.taskId,
          fixtureSha256: loaded.fixtureSha256,
          startCommit: loaded.startCommit,
          materializedTreeSha256: EMPTY_SHA256,
        },
        prompt: { sha256: loaded.promptSha256 },
        rubric: {
          sha256: loaded.rubricSha256,
          runnerSha256: loaded.rubricRunnerSha256,
          checkIds: loaded.checkIds,
        },
        corpus: plan.corpus,
        treatment: cell.treatment,
        model: plan.model,
        sandbox: plan.sandbox,
        toolCatalogSha256: plan.toolCatalogSha256,
        order: cell.order,
      },
      process: {
        exitCode: null,
        signal: null,
        timedOut: false,
        stdoutSha256: EMPTY_SHA256,
        stderrSha256: EMPTY_SHA256,
      },
      rubric: {
        expectedCheckIds: loaded.checkIds,
        observed: [],
        effective: loaded.checkIds.map((id) => ({
          id,
          pass: false,
          critical: false,
          error: `blocked by dependency: ${blockedBy.join(', ')}`,
          evidence: null,
          effectivePass: false,
          blockedByProcess: true,
        })),
      },
      metrics: {
        wallMilliseconds: unknown('cell was not invoked because a dependency failed'),
        inputTokens: unknown('cell was not invoked because a dependency failed'),
        cachedInputTokens: unknown('cell was not invoked because a dependency failed'),
        outputTokens: unknown('cell was not invoked because a dependency failed'),
        toolLoops: unknown('cell was not invoked because a dependency failed'),
        consumedPlanCredits: unknown('cell was not invoked because a dependency failed'),
        costUsd: unknown('cell was not invoked because a dependency failed'),
      },
      workspace: { disposed: true },
      diagnostics: { v0Adherence: unknown('cell was not invoked because a dependency failed') },
    };
    await this.store.write(record);
    return record;
  }
}

function unknown(reason: string): { status: 'unknown'; reason: string } {
  return { status: 'unknown', reason };
}

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}
