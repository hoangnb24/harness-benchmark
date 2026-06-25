import { cp, lstat, mkdtemp, mkdir, readdir, rm, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { SnapshotPolicy } from './SnapshotPolicy';
import type {
  WorkspaceSnapshotOptions,
  WorkspaceSnapshotStore,
} from '../ports/WorkspaceSnapshotStore';

export class FsWorkspaceSnapshotStore implements WorkspaceSnapshotStore {
  async save(options: WorkspaceSnapshotOptions): Promise<void> {
    const policy = new SnapshotPolicy({ runId: options.runId });
    const stagedParent = await mkdtemp(path.join(tmpdir(), 'harness-checkpoint-save-'));
    const staged = path.join(stagedParent, 'snapshot');

    try {
      await cp(options.workspaceDir, staged, {
        recursive: true,
        filter: (source) => {
          const relative = relativeToWorkspace(options.workspaceDir, source);
          return relative === '' || !policy.shouldExclude(relative);
        },
      });

      await mkdir(path.dirname(options.checkpointDir), { recursive: true });
      await rm(options.checkpointDir, { recursive: true, force: true });
      await cp(staged, options.checkpointDir, { recursive: true });
    } finally {
      await rm(stagedParent, { recursive: true, force: true });
    }
  }

  async restore(options: WorkspaceSnapshotOptions): Promise<void> {
    const policy = new SnapshotPolicy({ runId: options.runId });
    const sourceDir = await this.stageSnapshot(options.checkpointDir);
    try {
      await clearRestorableContents(options.workspaceDir, policy);
      await cp(sourceDir, options.workspaceDir, { recursive: true });
    } finally {
      await rm(path.dirname(sourceDir), { recursive: true, force: true });
    }
  }

  private async stageSnapshot(checkpointDir: string): Promise<string> {
    const stagedParent = await mkdtemp(path.join(tmpdir(), 'harness-checkpoint-restore-'));
    const staged = path.join(stagedParent, 'snapshot');
    await cp(checkpointDir, staged, { recursive: true });
    return staged;
  }
}

async function clearRestorableContents(
  targetDir: string,
  policy: SnapshotPolicy,
  rootDir = targetDir,
): Promise<void> {
  await mkdir(targetDir, { recursive: true });
  for (const entry of await readdir(targetDir)) {
    const entryPath = path.join(targetDir, entry);
    const relative = relativeToWorkspace(rootDir, entryPath);
    if (policy.shouldExclude(relative)) {
      continue;
    }

    const stat = await lstat(entryPath);
    if (!stat.isDirectory()) {
      await rm(entryPath, { force: true });
      continue;
    }

    await clearRestorableContents(entryPath, policy, rootDir);
    await rmdirIfEmpty(entryPath);
  }
}

async function rmdirIfEmpty(dir: string): Promise<void> {
  try {
    await rmdir(dir);
  } catch (error) {
    if (!isDirectoryNotEmpty(error) && !isNotFound(error)) {
      throw error;
    }
  }
}

function isDirectoryNotEmpty(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === 'ENOTEMPTY'
  );
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === 'ENOENT'
  );
}

function relativeToWorkspace(workspaceDir: string, source: string): string {
  const relative = path.relative(workspaceDir, source);
  return relative === '' ? '' : relative.replace(/\\/g, '/');
}
