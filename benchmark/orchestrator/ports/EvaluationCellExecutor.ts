import type { EvaluationCellSpec, KnownOrUnknown } from '../domain/evaluation';

export interface EvaluationCellExecution {
  exitCode: number;
  signal?: NodeJS.Signals | null;
  timedOut: boolean;
  stdout: Buffer;
  stderr: Buffer;
  wallMilliseconds: number;
  inputTokens: KnownOrUnknown<number>;
  cachedInputTokens?: KnownOrUnknown<number>;
  outputTokens: KnownOrUnknown<number>;
  toolLoops?: KnownOrUnknown<number>;
  consumedPlanCredits?: KnownOrUnknown<number>;
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
