import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  classifyFailure,
  firstRunnableStep,
  markStepFailed,
  markStepPassed,
  markStepRunning,
  type CheckpointState,
} from '../domain/checkpoint';
import { FsCheckpointStore } from '../infrastructure/FsCheckpointStore';
import { SnapshotPolicy } from '../infrastructure/SnapshotPolicy';

const baseState = (): CheckpointState => ({
  runId: 'resume-test',
  agent: 'codex',
  harnessRef: 'main',
  steps: [
    { task: 'T1-project-setup', status: 'pending', failureClass: null },
    { task: 'T2-crud-bookmarks', status: 'pending', failureClass: null },
  ],
});

describe('checkpoint state machine', () => {
  it('transitions a step through running and passed without mutating the original state', () => {
    const initial = baseState();
    const running = markStepRunning(initial, 'T1-project-setup', '2026-06-25T00:00:00Z');
    const passed = markStepPassed(
      running,
      'T1-project-setup',
      'checkpoints/T1-project-setup',
      '2026-06-25T00:01:00Z',
    );

    expect(initial.steps[0].status).toBe('pending');
    expect(running.steps[0]).toMatchObject({ status: 'running', failureClass: null });
    expect(passed.steps[0]).toMatchObject({
      status: 'passed',
      checkpoint: 'checkpoints/T1-project-setup',
      failureClass: null,
    });
    expect(firstRunnableStep(passed)?.task).toBe('T2-crud-bookmarks');
  });

  it('classifies retriable provider failures separately from fatal task failures', () => {
    expect(classifyFailure(124, '')).toBe('retriable');
    expect(classifyFailure(1, 'OpenAI insufficient_quota')).toBe('retriable');
    expect(classifyFailure(1, 'functional check failed')).toBe('fatal');
  });

  it('records failed step details', () => {
    const failed = markStepFailed(
      baseState(),
      'T1-project-setup',
      'retriable',
      124,
      'agent timeout',
      '2026-06-25T00:02:00Z',
    );

    expect(failed.steps[0]).toMatchObject({
      status: 'failed',
      failureClass: 'retriable',
      exitCode: 124,
      detail: 'agent timeout',
    });
  });
});

describe('FsCheckpointStore', () => {
  it('writes state atomically to state.json and can load it back', async () => {
    const runDir = await mkdtemp(path.join(tmpdir(), 'checkpoint-store-'));
    const store = new FsCheckpointStore(runDir);
    const state = markStepRunning(baseState(), 'T1-project-setup', '2026-06-25T00:00:00Z');

    await store.save(state);

    await expect(store.load('resume-test')).resolves.toEqual(state);
    await expect(readFile(path.join(runDir, 'state.json'), 'utf8')).resolves.toContain(
      '"runId": "resume-test"',
    );
  });
});

describe('SnapshotPolicy', () => {
  it('excludes recursive checkpoints, run artifacts, dependencies, and transient sqlite files', () => {
    const policy = new SnapshotPolicy({ runId: 'run-1' });

    expect(policy.shouldExclude('node_modules/typescript/index.js')).toBe(true);
    expect(policy.shouldExclude('benchmark/runs/run-1/checkpoints/T1/state.json')).toBe(true);
    expect(policy.shouldExclude('benchmark/runs/run-1/T1-project-setup/events.jsonl')).toBe(true);
    expect(policy.shouldExclude('benchmark/runs/run-1/report.md')).toBe(true);
    expect(policy.shouldExclude('data.db-wal')).toBe(true);
    expect(policy.shouldExclude('src/index.ts')).toBe(false);
    expect(policy.shouldExclude('harness.db')).toBe(false);
  });
});
