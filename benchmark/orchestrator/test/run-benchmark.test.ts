import { describe, expect, it } from 'vitest';
import { RunBenchmark } from '../application/RunBenchmark';
import type { CheckpointState } from '../domain/checkpoint';
import { CostModel } from '../domain/cost';
import { validateRunPlan, type TaskDefinition } from '../domain/task';
import { sumUsage } from '../domain/usage';
import type { AgentAdapter } from '../ports/AgentAdapter';
import type { CheckpointStore } from '../ports/CheckpointStore';
import type { Clock } from '../ports/Clock';
import type { FunctionalProbe } from '../ports/FunctionalProbe';

const task = (id: string, dependencies: string[] = []): TaskDefinition => ({
  id,
  title: id,
  promptPath: `benchmark/tasks/${id}.md`,
  rubricPath: `benchmark/rubrics/${id}.md`,
  expectedLane: 'normal',
  dependencies,
});

describe('RunBenchmark', () => {
  it('runs tasks through injected agent and functional ports', async () => {
    const invoked: string[] = [];
    const agent: AgentAdapter = {
      async invoke(taskDefinition) {
        invoked.push(taskDefinition.id);
        return { exitCode: 0 };
      },
    };
    const functional: FunctionalProbe = {
      async run(taskDefinition) {
        return [{ name: `${taskDefinition.id}-check`, pass: true }];
      },
    };

    const runner = new RunBenchmark({ agent, functional });
    const result = await runner.run(
      { runId: 'm0', tasks: [task('T1-project-setup'), task('T2-crud-bookmarks')] },
      { projectDir: '/tmp/project', runDir: '/tmp/run' },
    );

    expect(invoked).toEqual(['T1-project-setup', 'T2-crud-bookmarks']);
    expect(result.tasks.map((item) => item.status)).toEqual(['passed', 'passed']);
  });

  it('persists running and passed checkpoint transitions during execution', async () => {
    const checkpoints = new RecordingCheckpointStore();
    const runner = new RunBenchmark({
      agent: {
        async invoke() {
          return { exitCode: 0 };
        },
      },
      functional: {
        async run() {
          return [{ name: 'ok', pass: true }];
        },
      },
      checkpoints,
      clock: fixedClock(),
    });

    await runner.run(
      { runId: 'checkpointed', tasks: [task('T1-project-setup')] },
      { projectDir: '/tmp/project', runDir: '/tmp/run' },
    );

    expect(checkpoints.saved.map((state) => state.steps[0].status)).toEqual(['running', 'passed']);
    expect(checkpoints.saved[1].steps[0]).toMatchObject({
      checkpoint: 'checkpoints/T1-project-setup',
      failureClass: null,
    });
  });

  it('classifies agent and functional failures in checkpoint state', async () => {
    const checkpoints = new RecordingCheckpointStore();
    const runner = new RunBenchmark({
      agent: {
        async invoke(taskDefinition) {
          return taskDefinition.id === 'T1-project-setup'
            ? { exitCode: 1, stderr: 'OpenAI insufficient_quota' }
            : { exitCode: 0 };
        },
      },
      functional: {
        async run(taskDefinition) {
          return [
            { name: `${taskDefinition.id}-check`, pass: taskDefinition.id !== 'T2-crud-bookmarks' },
          ];
        },
      },
      checkpoints,
      clock: fixedClock(),
    });

    await runner.run(
      {
        runId: 'checkpointed-failures',
        tasks: [task('T1-project-setup'), task('T2-crud-bookmarks')],
      },
      { projectDir: '/tmp/project', runDir: '/tmp/run' },
    );

    const final = checkpoints.saved.at(-1);
    expect(final?.steps[0]).toMatchObject({ status: 'failed', failureClass: 'retriable' });
    expect(final?.steps[1]).toMatchObject({ status: 'failed', failureClass: 'fatal' });
  });
});

class RecordingCheckpointStore implements CheckpointStore {
  readonly saved: CheckpointState[] = [];

  async load(): Promise<CheckpointState | null> {
    return null;
  }

  async save(state: CheckpointState): Promise<void> {
    this.saved.push(JSON.parse(JSON.stringify(state)) as CheckpointState);
  }
}

function fixedClock(): Clock {
  return {
    now: () => new Date('2026-06-25T00:00:00Z'),
  };
}

describe('domain helpers', () => {
  it('rejects tasks that appear before their dependencies', () => {
    expect(() =>
      validateRunPlan({ runId: 'bad', tasks: [task('T2-crud-bookmarks', ['T1-project-setup'])] }),
    ).toThrow(/depends on T1-project-setup/);
  });

  it('sums usage without adding reasoning tokens to total tokens twice', () => {
    const totals = sumUsage([
      {
        model: 'gpt-test',
        inputTokens: 100,
        cachedInputTokens: 50,
        outputTokens: 30,
        reasoningTokens: 10,
      },
    ]);

    expect(totals.totalTokens).toBe(180);
    expect(totals.reasoningTokens).toBe(10);
  });

  it('charges separately reported reasoning only when the interaction opts in', () => {
    const cost = new CostModel(
      new Map([
        [
          'gpt-test',
          {
            model: 'gpt-test',
            provider: 'openai',
            inputUsdPerMillion: 1,
            cachedInputUsdPerMillion: 0.1,
            outputUsdPerMillion: 10,
            reasoningUsdPerMillion: 20,
          },
        ],
      ]),
    );

    expect(
      cost.costForInteraction({
        model: 'gpt-test',
        inputTokens: 1_000_000,
        cachedInputTokens: 0,
        outputTokens: 1_000_000,
        reasoningTokens: 1_000_000,
      }).costUsd,
    ).toBe(11);

    expect(
      cost.costForInteraction({
        model: 'gpt-test',
        inputTokens: 1_000_000,
        cachedInputTokens: 0,
        outputTokens: 1_000_000,
        reasoningTokens: 1_000_000,
        reasoningTokensBilledSeparately: true,
      }).costUsd,
    ).toBe(31);
  });
});
