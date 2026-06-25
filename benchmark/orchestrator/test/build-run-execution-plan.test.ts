import { describe, expect, it } from 'vitest';
import { BuildRunExecutionPlan } from '../application/BuildRunExecutionPlan';
import type { ResumePlan } from '../application/ResumeRun';
import type { RunPlan, TaskDefinition } from '../domain/task';

const task = (id: string): TaskDefinition => ({
  id,
  title: id,
  promptPath: `benchmark/tasks/${id}.md`,
  rubricPath: `benchmark/rubrics/${id}.md`,
  expectedLane: 'normal',
  dependencies: [],
});

describe('BuildRunExecutionPlan', () => {
  it('selects runnable task definitions and restore checkpoints from a resume plan', () => {
    const fullPlan: RunPlan = {
      runId: 'resume-run',
      tasks: [task('T1-project-setup'), task('T2-crud-bookmarks'), task('T3-folder-support')],
    };
    const resumePlan: ResumePlan = {
      runId: 'resume-run',
      steps: [
        {
          task: 'T2-crud-bookmarks',
          status: 'failed',
          failureClass: 'retriable',
          restoreCheckpoint: 'checkpoints/T1-project-setup',
        },
        {
          task: 'T3-folder-support',
          status: 'pending',
          failureClass: null,
          restoreCheckpoint: 'checkpoints/T2-crud-bookmarks',
        },
      ],
    };

    const execution = new BuildRunExecutionPlan().fromResumePlan(fullPlan, resumePlan);

    expect(execution.plan).toMatchObject({
      runId: 'resume-run',
      tasks: [{ id: 'T2-crud-bookmarks' }, { id: 'T3-folder-support' }],
    });
    expect(execution.restoreCheckpoints).toEqual({
      'T2-crud-bookmarks': 'checkpoints/T1-project-setup',
      'T3-folder-support': 'checkpoints/T2-crud-bookmarks',
    });
  });

  it('passes through empty no-op resume plans', () => {
    const execution = new BuildRunExecutionPlan().fromResumePlan(
      { runId: 'done', tasks: [task('T1-project-setup')] },
      { runId: 'done', steps: [] },
    );

    expect(execution.plan.tasks).toEqual([]);
    expect(execution.restoreCheckpoints).toEqual({});
  });

  it('drops dependencies satisfied by restored checkpoints from resumed subsets', () => {
    const t1 = task('T1-project-setup');
    const t2 = { ...task('T2-crud-bookmarks'), dependencies: ['T1-project-setup'] };
    const t3 = { ...task('T3-folder-support'), dependencies: ['T2-crud-bookmarks'] };

    const execution = new BuildRunExecutionPlan().fromResumePlan(
      { runId: 'resume-run', tasks: [t1, t2, t3] },
      {
        runId: 'resume-run',
        steps: [
          {
            task: 'T3-folder-support',
            status: 'failed',
            failureClass: 'retriable',
            restoreCheckpoint: 'checkpoints/T2-crud-bookmarks',
          },
        ],
      },
    );

    expect(execution.plan.tasks).toEqual([{ ...t3, dependencies: [] }]);
  });

  it('rejects resume plans that reference unknown tasks', () => {
    expect(() =>
      new BuildRunExecutionPlan().fromResumePlan(
        { runId: 'bad', tasks: [task('T1-project-setup')] },
        {
          runId: 'bad',
          steps: [
            {
              task: 'T9-missing',
              status: 'pending',
              failureClass: null,
            },
          ],
        },
      ),
    ).toThrow(/resume plan references unknown task: T9-missing/);
  });
});
