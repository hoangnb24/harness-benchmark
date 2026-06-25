import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { CheckpointState } from '../domain/checkpoint';
import type { CheckpointStore } from '../ports/CheckpointStore';

export class FsCheckpointStore implements CheckpointStore {
  constructor(private readonly runDir: string) {}

  async load(runId: string): Promise<CheckpointState | null> {
    try {
      const state = JSON.parse(await readFile(this.statePath(runId), 'utf8')) as CheckpointState;
      return state;
    } catch (error) {
      if (isNotFound(error)) {
        return null;
      }

      throw error;
    }
  }

  async save(state: CheckpointState): Promise<void> {
    await mkdir(this.runDir, { recursive: true });

    const target = this.statePath(state.runId);
    const temp = `${target}.tmp-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    await writeFile(temp, `${JSON.stringify(state, null, 2)}\n`);
    await rename(temp, target);
  }

  private statePath(_runId: string): string {
    return path.join(this.runDir, 'state.json');
  }
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === 'ENOENT'
  );
}
