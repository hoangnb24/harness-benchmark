export interface SnapshotPolicyOptions {
  runId: string;
}

export class SnapshotPolicy {
  constructor(private readonly options: SnapshotPolicyOptions) {}

  shouldExclude(relativePath: string): boolean {
    const normalized = relativePath.replace(/\\/g, '/').replace(/^\.\//, '');

    return (
      normalized === 'node_modules' ||
      normalized.startsWith('node_modules/') ||
      normalized === `benchmark/runs/${this.options.runId}/checkpoints` ||
      normalized.startsWith(`benchmark/runs/${this.options.runId}/checkpoints/`) ||
      normalized.startsWith(`benchmark/runs/${this.options.runId}/T`) ||
      normalized === `benchmark/runs/${this.options.runId}/report.md` ||
      normalized === `benchmark/runs/${this.options.runId}/scores.json` ||
      normalized.endsWith('.db-wal') ||
      normalized.endsWith('.db-shm') ||
      normalized.startsWith('.npm/') ||
      normalized.startsWith('.cache/')
    );
  }
}
