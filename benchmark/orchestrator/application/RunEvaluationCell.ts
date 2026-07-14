import path from 'node:path';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import {
  effectiveRubricResults,
  type EvaluationCellSpec,
  type EvaluationPlan,
  type RawCellRecord,
} from '../domain/evaluation';
import type { EvaluationCellExecutor } from '../ports/EvaluationCellExecutor';
import type { EvaluationRubricEvaluator } from '../ports/EvaluationRubricEvaluator';
import type { EvaluationTreatmentMaterializer } from '../ports/EvaluationTreatmentMaterializer';
import type { EvaluationWorkspace } from '../ports/EvaluationWorkspace';
import type { RawCellStore } from '../ports/RawCellStore';

export class RunEvaluationCell {
  constructor(
    private readonly workspace: EvaluationWorkspace,
    private readonly treatment: EvaluationTreatmentMaterializer,
    private readonly executor: EvaluationCellExecutor,
    private readonly rubric: EvaluationRubricEvaluator,
    private readonly store: RawCellStore,
  ) {}

  async execute(plan: EvaluationPlan, cell: EvaluationCellSpec): Promise<RawCellRecord> {
    const loadedRubric = await this.rubric.load(cell, plan.corpus.root);
    const prepared = await this.workspace.prepare(cell, plan.corpus.root);
    let disposed = false;
    try {
      if (
        prepared.fixture.taskId !== loadedRubric.taskId ||
        prepared.fixture.fixtureSha256 !== loadedRubric.fixtureSha256 ||
        prepared.fixture.startCommit !== loadedRubric.startCommit
      ) {
        throw new Error(`fixture identity differs from frozen rubric identity for ${cell.id}`);
      }
      const materializedTreatment = await this.treatment.materializeAndApply(
        cell,
        prepared.workspaceDir,
        prepared.rootDir,
      );
      const treatmentApplication = materializedTreatment.receipt;
      const beforeSha256 = await this.workspace.digest(prepared.workspaceDir);
      const rubricStart = await this.workspace.prepareRubricStart(prepared);
      const process = await this.executor.execute({
        cell,
        workspaceDir: prepared.workspaceDir,
        submissionDir: prepared.submissionDir,
        prompt: loadedRubric.prompt,
      });
      const score = await this.rubric.evaluate({
        rubric: loadedRubric,
        corpusRoot: plan.corpus.root,
        workspaceDir: prepared.workspaceDir,
        submissionDir: prepared.submissionDir,
        fixtureReceiptPath: rubricStart.path,
        scoreReceiptPath: path.join(prepared.rootDir, 'receipts', 'score.json'),
      });
      const effective = effectiveRubricResults(
        loadedRubric.checkIds,
        score.results,
        process.exitCode,
      );
      const afterSha256 = await this.workspace.digest(prepared.workspaceDir);
      const workspaceDiff = await this.workspace.diff(prepared.workspaceDir);
      const diffSha256 = sha256(workspaceDiff);
      const evidence = await this.store.stageEvidence(cell.id, {
        stdout: process.stdout,
        stderr: process.stderr,
        fixtureReceipt: await readFile(prepared.fixtureReceiptPath),
        rubricStartReceipt: rubricStart.bytes,
        metricsReceipt: process.metricsReceipt,
        workspaceDiff,
        scoreReceipt: await readFile(path.join(prepared.rootDir, 'receipts', 'score.json')),
        treatmentApplicationReceipt: materializedTreatment.receiptBytes,
      });
      const record: RawCellRecord = {
        version: 1,
        runId: plan.runId,
        cellId: cell.id,
        mode: cell.mode,
        dependencies: [...cell.dependencies],
        status: process.exitCode === 0 && effective.every((result) => result.effectivePass)
          ? 'passed'
          : 'failed',
        identities: {
          runner: plan.runner,
          fixture: prepared.fixture,
          prompt: { sha256: loadedRubric.promptSha256 },
          rubric: {
            sha256: loadedRubric.rubricSha256,
            runnerSha256: loadedRubric.rubricRunnerSha256,
            checkIds: loadedRubric.checkIds,
          },
          corpus: plan.corpus,
          treatment: {
            ...cell.treatment,
            candidateId: treatmentApplication.candidateId,
            stagedTreeSha256: treatmentApplication.stagedTreeSha256,
            appliedTreeSha256: treatmentApplication.resultingTreeSha256,
          },
          model: plan.model,
          sandbox: plan.sandbox,
          toolCatalogSha256: plan.toolCatalogSha256,
          order: cell.order,
        },
        process: {
          exitCode: process.exitCode,
          timedOut: process.timedOut,
          stdoutSha256: sha256(process.stdout),
          stderrSha256: sha256(process.stderr),
        },
        evidence,
        rubric: {
          scoreReceiptSha256: score.receiptSha256,
          expectedCheckIds: loadedRubric.checkIds,
          observed: score.results,
          effective,
        },
        metrics: {
          wallMilliseconds: { status: 'known', value: process.wallMilliseconds },
          inputTokens: process.inputTokens,
          outputTokens: process.outputTokens,
          costUsd: process.costUsd,
        },
        workspace: {
          beforeSha256,
          afterSha256,
          diffSha256,
          disposed: false,
        },
        treatmentApplication,
        diagnostics: {
          v0Adherence: {
            status: 'unknown',
            reason: 'v0 adherence is diagnostic-only and is not collected by Phase 0 qualification',
          },
        },
      };
      await this.workspace.dispose(prepared.rootDir);
      disposed = true;
      record.workspace.disposed = true;
      await this.store.write(record);
      return record;
    } finally {
      if (!disposed) await this.workspace.dispose(prepared.rootDir);
    }
  }
}

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}
