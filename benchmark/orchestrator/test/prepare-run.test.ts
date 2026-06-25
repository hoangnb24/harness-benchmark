import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { PrepareRun } from '../application/PrepareRun';
import { FsCheckpointStore } from '../infrastructure/FsCheckpointStore';
import { TaskManifestLoader } from '../infrastructure/TaskManifestLoader';
import { runCli } from '../interface/cli';

describe('PrepareRun', () => {
  it('creates a pending checkpoint state from the task manifest', async () => {
    const runDir = await mkdtemp(path.join(tmpdir(), 'prepare-run-'));
    const plan = await new TaskManifestLoader().load('prepare-test');
    const prepared = await new PrepareRun(new FsCheckpointStore(runDir)).prepare(plan, {
      agent: 'codex',
      model: 'gpt-test',
      harnessRef: 'main',
      workspaceDir: '/tmp/workspace',
    });

    expect(prepared.taskIds).toHaveLength(12);
    expect(prepared.state.steps.every((step) => step.status === 'pending')).toBe(true);
    await expect(readFile(path.join(runDir, 'state.json'), 'utf8')).resolves.toContain(
      '"harnessRef": "main"',
    );
  });

  it('exposes run planning through the dry-run CLI', async () => {
    const runDir = await mkdtemp(path.join(tmpdir(), 'prepare-run-cli-'));
    let stdout = '';
    const code = await runCli(['run', '--dry-run', '--run-id', 'dry', '--run-dir', runDir], {
      stdout: (message) => {
        stdout += message;
      },
      stderr: () => {},
    });

    expect(code).toBe(0);
    expect(stdout).toContain('Prepared run dry: 12 tasks');
    expect(stdout).toContain('- T12-cursor-pagination');
    await expect(readFile(path.join(runDir, 'state.json'), 'utf8')).resolves.toContain(
      '"task": "T1-project-setup"',
    );
  });
});
