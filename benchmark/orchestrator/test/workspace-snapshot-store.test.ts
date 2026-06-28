import { access, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { FsWorkspaceSnapshotStore } from '../infrastructure/FsWorkspaceSnapshotStore';

describe('FsWorkspaceSnapshotStore', () => {
  it('saves workspace checkpoints with run artifacts and transient files excluded', async () => {
    const workspaceDir = await mkdtemp(path.join(tmpdir(), 'workspace-snapshot-save-'));
    const checkpointDir = path.join(workspaceDir, 'benchmark/runs/run-1/checkpoints/T1');
    await writeText(path.join(workspaceDir, 'src/index.ts'), 'source v1');
    await writeText(path.join(workspaceDir, 'harness.db'), 'harness');
    await writeText(path.join(workspaceDir, 'data.db-wal'), 'wal');
    await writeText(path.join(workspaceDir, 'node_modules/pkg/index.js'), 'dependency');
    await writeText(path.join(workspaceDir, 'benchmark/runs/run-1/T1/events.jsonl'), '{}');
    await writeText(path.join(workspaceDir, 'benchmark/runs/run-1/state.json'), '{"ok":true}');

    await new FsWorkspaceSnapshotStore().save({ runId: 'run-1', workspaceDir, checkpointDir });

    await expect(readFile(path.join(checkpointDir, 'src/index.ts'), 'utf8')).resolves.toBe(
      'source v1',
    );
    await expect(readFile(path.join(checkpointDir, 'harness.db'), 'utf8')).resolves.toBe('harness');
    await expect(exists(path.join(checkpointDir, 'node_modules/pkg/index.js'))).resolves.toBe(
      false,
    );
    await expect(exists(path.join(checkpointDir, 'data.db-wal'))).resolves.toBe(false);
    await expect(
      exists(path.join(checkpointDir, 'benchmark/runs/run-1/T1/events.jsonl')),
    ).resolves.toBe(false);
    await expect(
      exists(path.join(checkpointDir, 'benchmark/runs/run-1/checkpoints/T1/src/index.ts')),
    ).resolves.toBe(false);
  });

  it('restores checkpoint contents while preserving run state and checkpoint artifacts', async () => {
    const workspaceDir = await mkdtemp(path.join(tmpdir(), 'workspace-snapshot-restore-'));
    const checkpointDir = path.join(workspaceDir, 'benchmark/runs/run-1/checkpoints/T1');
    const store = new FsWorkspaceSnapshotStore();

    await writeText(path.join(workspaceDir, 'src/index.ts'), 'source v1');
    await writeText(path.join(workspaceDir, 'harness.db'), 'harness v1');
    await writeText(path.join(workspaceDir, 'benchmark/runs/run-1/state.json'), '{"state":"keep"}');
    await store.save({ runId: 'run-1', workspaceDir, checkpointDir });

    await writeText(path.join(workspaceDir, 'src/index.ts'), 'source v2');
    await writeText(path.join(workspaceDir, 'src/extra.ts'), 'extra');
    await writeText(path.join(workspaceDir, 'harness.db'), 'harness v2');
    await writeText(path.join(workspaceDir, 'benchmark/runs/run-1/T2/events.jsonl'), '{}');

    await store.restore({ runId: 'run-1', workspaceDir, checkpointDir });

    await expect(readFile(path.join(workspaceDir, 'src/index.ts'), 'utf8')).resolves.toBe(
      'source v1',
    );
    await expect(readFile(path.join(workspaceDir, 'harness.db'), 'utf8')).resolves.toBe(
      'harness v1',
    );
    await expect(exists(path.join(workspaceDir, 'src/extra.ts'))).resolves.toBe(false);
    await expect(
      readFile(path.join(workspaceDir, 'benchmark/runs/run-1/state.json'), 'utf8'),
    ).resolves.toBe('{"state":"keep"}');
    await expect(readFile(path.join(checkpointDir, 'src/index.ts'), 'utf8')).resolves.toBe(
      'source v1',
    );
    await expect(
      readFile(path.join(workspaceDir, 'benchmark/runs/run-1/T2/events.jsonl'), 'utf8'),
    ).resolves.toBe('{}');
  });
});

async function writeText(filePath: string, contents: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, contents);
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}
