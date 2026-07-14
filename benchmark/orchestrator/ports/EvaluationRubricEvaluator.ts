import type {
  EvaluationCellSpec,
  ObservedRubricResult,
} from '../domain/evaluation';

export interface LoadedRubric {
  taskId: string;
  fixtureSha256: string;
  startCommit: string;
  prompt: string;
  promptSha256: string;
  rubricSha256: string;
  rubricRunnerSha256: string;
  checkIds: string[];
}

export interface EvaluationRubricEvaluator {
  load(cell: EvaluationCellSpec, corpusRoot: string): Promise<LoadedRubric>;
  evaluate(input: {
    rubric: LoadedRubric;
    corpusRoot: string;
    workspaceDir: string;
    submissionDir: string;
    fixtureReceiptPath: string;
    scoreReceiptPath: string;
  }): Promise<{ results: ObservedRubricResult[]; receiptSha256: string }>;
}
