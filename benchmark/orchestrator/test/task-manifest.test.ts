import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { TaskManifestLoader } from '../infrastructure/TaskManifestLoader';

describe('TaskManifestLoader', () => {
  it('loads the committed T1-T6 manifest in dependency-valid order', async () => {
    const plan = await new TaskManifestLoader().load('manifest-test');

    expect(plan.tasks.map((task) => task.id)).toEqual([
      'T1-project-setup',
      'T2-crud-bookmarks',
      'T3-folder-support',
      'T4-authentication',
      'T5-bug-fix',
      'T6-pagination',
      'T7-tags',
      'T8-search',
      'T9-import-export',
      'T10-folder-sharing',
      'T11-concurrency',
      'T12-cursor-pagination',
    ]);
    expect(plan.tasks[0]).toMatchObject({
      expectedLane: 'tiny',
      functionalCheckPath: 'benchmark/tasks/checks/T1-project-setup.json',
    });
    expect(plan.tasks[3]).toMatchObject({
      expectedLane: 'high_risk',
      dependencies: ['T3-folder-support'],
    });
    expect(plan.tasks[9]).toMatchObject({
      id: 'T10-folder-sharing',
      expectedLane: 'high_risk',
      dependencies: ['T9-import-export'],
    });
  });

  it('allows a dummy task to be registered by data only', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'task-manifest-'));
    const manifestPath = path.join(dir, 'manifest.json');
    await writeFile(
      manifestPath,
      JSON.stringify({
        version: 1,
        tasks: [
          {
            id: 'T0-dummy',
            title: 'Dummy',
            promptPath: 'benchmark/tasks/T0-dummy.md',
            rubricPath: 'benchmark/rubrics/T0-dummy.md',
            expectedLane: 'tiny',
            dependencies: [],
            functionalCheckPath: 'benchmark/tasks/checks/T0-dummy.json',
          },
        ],
      }),
    );

    const plan = await new TaskManifestLoader(manifestPath).load('dummy-run');
    expect(plan.tasks).toHaveLength(1);
    expect(plan.tasks[0].id).toBe('T0-dummy');
  });

  it('rejects manifests where a task appears before its dependency', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'task-manifest-bad-'));
    const manifestPath = path.join(dir, 'manifest.json');
    await writeFile(
      manifestPath,
      JSON.stringify({
        version: 1,
        tasks: [
          {
            id: 'T2',
            title: 'Bad',
            promptPath: 'benchmark/tasks/T2.md',
            rubricPath: 'benchmark/rubrics/T2.md',
            expectedLane: 'normal',
            dependencies: ['T1'],
          },
        ],
      }),
    );

    await expect(new TaskManifestLoader(manifestPath).load('bad-run')).rejects.toThrow(
      /depends on T1/,
    );
  });
});
