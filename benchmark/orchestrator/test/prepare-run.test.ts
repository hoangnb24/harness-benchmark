import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { PrepareRun } from '../application/PrepareRun';
import { markStepFailed, markStepPassed, type CheckpointState } from '../domain/checkpoint';
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

  it('exposes resume planning through the dry-run CLI', async () => {
    const runDir = await mkdtemp(path.join(tmpdir(), 'resume-run-cli-'));
    const store = new FsCheckpointStore(runDir);
    const state: CheckpointState = {
      runId: 'resume-dry',
      agent: 'codex',
      harnessRef: 'main',
      steps: [
        { task: 'T1-project-setup', status: 'pending', failureClass: null },
        { task: 'T2-crud-bookmarks', status: 'pending', failureClass: null },
        { task: 'T3-folder-support', status: 'pending', failureClass: null },
      ],
    };
    await store.save(
      markStepFailed(
        markStepPassed(
          state,
          'T1-project-setup',
          'checkpoints/T1-project-setup',
          '2026-06-25T00:01:00Z',
        ),
        'T2-crud-bookmarks',
        'retriable',
        124,
        'timeout',
        '2026-06-25T00:02:00Z',
      ),
    );

    let stdout = '';
    const code = await runCli(
      ['run', '--dry-run', '--resume', 'resume-dry', '--run-dir', runDir],
      {
        stdout: (message) => {
          stdout += message;
        },
        stderr: () => {},
      },
    );

    expect(code).toBe(0);
    expect(stdout).toContain('Planned run resume-dry: 2 tasks');
    expect(stdout).toContain('- T2-crud-bookmarks (restore checkpoints/T1-project-setup)');
    expect(stdout).toContain('- T3-folder-support');
  });

  it('rejects conflicting resume selectors through the dry-run CLI', async () => {
    const runDir = await mkdtemp(path.join(tmpdir(), 'resume-run-cli-conflict-'));
    let stderr = '';
    const code = await runCli(
      [
        'run',
        '--dry-run',
        '--run-id',
        'fresh-dry',
        '--run-dir',
        runDir,
        '--only',
        'T1-project-setup',
        '--from',
        'T2-crud-bookmarks',
      ],
      {
        stdout: () => {},
        stderr: (message) => {
          stderr += message;
        },
      },
    );

    expect(code).toBe(1);
    expect(stderr).toContain('choose only one resume selector');
  });

  it('fails fast when the requested model is missing from pricing', async () => {
    const runDir = await mkdtemp(path.join(tmpdir(), 'prepare-run-pricing-missing-'));
    let stderr = '';
    const code = await runCli(
      ['run', '--dry-run', '--run-id', 'missing-pricing', '--run-dir', runDir, '--model', 'nope'],
      {
        stdout: () => {},
        stderr: (message) => {
          stderr += message;
        },
      },
    );

    expect(code).toBe(1);
    expect(stderr).toContain('missing pricing for model: nope');
    expect(stderr).toContain('--allow-missing-pricing');
  });

  it('allows missing pricing only when explicitly requested', async () => {
    const runDir = await mkdtemp(path.join(tmpdir(), 'prepare-run-pricing-allowed-'));
    let stderr = '';
    const code = await runCli(
      [
        'run',
        '--dry-run',
        '--run-id',
        'allowed-pricing',
        '--run-dir',
        runDir,
        '--model',
        'nope',
        '--allow-missing-pricing',
      ],
      {
        stdout: () => {},
        stderr: (message) => {
          stderr += message;
        },
      },
    );

    expect(code).toBe(0);
    expect(stderr).toContain('Warning: missing pricing for model nope');
    await expect(readFile(path.join(runDir, 'state.json'), 'utf8')).resolves.toContain(
      '"model": "nope"',
    );
  });
});
