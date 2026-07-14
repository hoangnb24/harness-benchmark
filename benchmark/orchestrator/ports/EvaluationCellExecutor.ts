import type { EvaluationCellSpec, KnownOrUnknown } from '../domain/evaluation';

export interface EvaluationCellExecution {
  exitCode: number;
  timedOut: boolean;
  stdout: Buffer;
  stderr: Buffer;
  wallMilliseconds: number;
  inputTokens: KnownOrUnknown<number>;
  outputTokens: KnownOrUnknown<number>;
  costUsd: KnownOrUnknown<number>;
  metricsReceipt: Buffer;
}

export interface EvaluationCellExecutor {
  execute(input: {
    cell: EvaluationCellSpec;
    workspaceDir: string;
    submissionDir: string;
    prompt: string;
  }): Promise<EvaluationCellExecution>;
}
