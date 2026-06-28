export interface WorkspaceSnapshotOptions {
  runId: string;
  workspaceDir: string;
  checkpointDir: string;
}

export interface WorkspaceSnapshotStore {
  save(options: WorkspaceSnapshotOptions): Promise<void>;
  restore(options: WorkspaceSnapshotOptions): Promise<void>;
}
