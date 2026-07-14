import type { EvaluationCellSpec } from '../domain/evaluation';

export interface PreparedEvaluationWorkspace {
  rootDir: string;
  workspaceDir: string;
  submissionDir: string;
  fixtureReceiptPath: string;
  fixture: {
    taskId: string;
    fixtureSha256: string;
    startCommit: string;
    materializedTreeSha256: string;
  };
  beforeSha256: string;
}

export interface EvaluationWorkspace {
  prepare(cell: EvaluationCellSpec, corpusRoot: string): Promise<PreparedEvaluationWorkspace>;
  digest(workspaceDir: string): Promise<string>;
  prepareRubricStart(prepared: PreparedEvaluationWorkspace): Promise<{
    path: string;
    bytes: Buffer;
  }>;
  diff(workspaceDir: string): Promise<Buffer>;
  dispose(rootDir: string): Promise<void>;
}
