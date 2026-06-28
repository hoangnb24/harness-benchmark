import { describe, expect, it } from 'vitest';
import { ResumeRun } from '../application/ResumeRun';
import type { CheckpointState } from '../domain/checkpoint';

const state = (): CheckpointState => ({
  runId: 'resume-plan',
  agent: 'codex',
  harnessRef: 'main',
  steps: [
    {
      task: 'T1-project-setup',
      status: 'passed',
      checkpoint: 'checkpoints/T1-project-setup',
      failureClass: null,
    },
    {
      task: 'T2-crud-bookmarks',
      status: 'failed',
      failureClass: 'retriable',
      exitCode: 124,
      detail: 'timeout',
    },
    {
      task: 'T3-folder-support',
      status: 'passed',
      checkpoint: 'checkpoints/T3-folder-support',
      failureClass: null,
    },
    { task: 'T4-authentication', status: 'failed', failureClass: 'fatal' },
    { task: 'T5-bug-fix', status: 'pending', failureClass: null },
  ],
});

describe('ResumeRun', () => {
  it('resumes at the first non-passed step without re-running earlier passed steps', () => {
    const plan = new ResumeRun().plan(state(), { kind: 'resume' });

    expect(plan.steps.map((step) => step.task)).toEqual([
      'T2-crud-bookmarks',
      'T4-authentication',
      'T5-bug-fix',
    ]);
    expect(plan.steps[0].restoreCheckpoint).toBe('checkpoints/T1-project-setup');
  });

  it('runs only one step, treating a passed step as a no-op unless forced', () => {
    const resume = new ResumeRun();

    expect(resume.plan(state(), { kind: 'only', task: 'T1-project-setup' }).steps).toEqual([]);
    expect(
      resume.plan(state(), { kind: 'only', task: 'T1-project-setup', force: true }).steps,
    ).toMatchObject([{ task: 'T1-project-setup', restoreCheckpoint: 'checkpoints/pre-run' }]);
  });

  it('runs from a named task through the end', () => {
    const plan = new ResumeRun().plan(state(), { kind: 'from', task: 'T3-folder-support' });

    expect(plan.steps.map((step) => step.task)).toEqual([
      'T3-folder-support',
      'T4-authentication',
      'T5-bug-fix',
    ]);
  });

  it('runs explicit steps and skips already-passed selections unless forced', () => {
    const resume = new ResumeRun();

    expect(
      resume
        .plan(state(), { kind: 'steps', tasks: ['T1-project-setup', 'T5-bug-fix'] })
        .steps.map((step) => step.task),
    ).toEqual(['T5-bug-fix']);
    expect(
      resume
        .plan(state(), { kind: 'steps', tasks: ['T1-project-setup', 'T5-bug-fix'], force: true })
        .steps.map((step) => step.task),
    ).toEqual(['T1-project-setup', 'T5-bug-fix']);
  });

  it('retries only retriable failed steps', () => {
    const plan = new ResumeRun().plan(state(), { kind: 'retry-failed' });

    expect(plan.steps.map((step) => step.task)).toEqual(['T2-crud-bookmarks']);
  });

  it('rejects unknown task selectors', () => {
    expect(() => new ResumeRun().plan(state(), { kind: 'only', task: 'missing' })).toThrow(
      /unknown checkpoint step: missing/,
    );
  });
});
