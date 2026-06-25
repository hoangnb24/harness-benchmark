import { describe, expect, it } from 'vitest';
import {
  ClaudeCodeAdapter,
  CustomAgentAdapter,
  LegacyCodexAdapter,
  type CommandRunner,
} from '../infrastructure/LegacyCodexAdapter';
import { buildRunner } from '../interface/composition-root';
import type { TaskDefinition } from '../domain/task';
import type { FunctionalProbe } from '../ports/FunctionalProbe';

const task: TaskDefinition = {
  id: 'T1-project-setup',
  title: 'T1',
  promptPath: 'benchmark/tasks/T1-project-setup.md',
  rubricPath: 'benchmark/rubrics/T1-project-setup.md',
  expectedLane: 'normal',
  dependencies: [],
};

describe('agent adapters', () => {
  it('invokes Codex through JSON event output', async () => {
    const runner = new RecordingCommandRunner();
    const result = await new LegacyCodexAdapter(runner).invoke(task, context());

    expect(runner.calls[0]).toMatchObject({
      command: 'codex',
      args: ['exec', '--json', '--color', 'never', '-C', '/tmp/project'],
      stdinPath: task.promptPath,
      stdoutPath: '/tmp/run/T1-project-setup/events.jsonl',
    });
    expect(result.eventsPath).toBe('/tmp/run/T1-project-setup/events.jsonl');
  });

  it('invokes Claude through JSON stdout for Anthropic usage parsing', async () => {
    const runner = new RecordingCommandRunner();
    const result = await new ClaudeCodeAdapter(runner).invoke(task, context());

    expect(runner.calls[0]).toMatchObject({
      command: 'claude',
      args: ['--output-format', 'json'],
      stdinPath: task.promptPath,
      stdoutPath: '/tmp/run/T1-project-setup/result.json',
    });
    expect(result.stdoutPath).toBe('/tmp/run/T1-project-setup/result.json');
  });

  it('invokes a configured custom command and captures usage.json', async () => {
    const runner = new RecordingCommandRunner();
    const result = await new CustomAgentAdapter(runner, 'agentctl', ['run']).invoke(
      task,
      context(),
    );

    expect(runner.calls[0]).toMatchObject({
      command: 'agentctl',
      args: ['run'],
      stdinPath: task.promptPath,
      stdoutPath: '/tmp/run/T1-project-setup/usage.json',
    });
    expect(result.stdoutPath).toBe('/tmp/run/T1-project-setup/usage.json');
  });
});

describe('buildRunner', () => {
  it('builds a Claude runner from the composition root', async () => {
    const runner = new RecordingCommandRunner();
    const benchmark = buildRunner({
      agent: 'claude',
      commandRunner: runner,
      functional: passingFunctional(),
    });

    await benchmark.run({ runId: 'multi-agent', tasks: [task] }, context());

    expect(runner.calls[0].command).toBe('claude');
  });

  it('requires a command for custom runners', () => {
    expect(() =>
      buildRunner({
        agent: 'custom',
        commandRunner: new RecordingCommandRunner(),
        functional: passingFunctional(),
      }),
    ).toThrow(/customCommand is required/);
  });
});

class RecordingCommandRunner implements CommandRunner {
  readonly calls: Array<{
    command: string;
    args: string[];
    cwd: string;
    stdinPath?: string;
    stdoutPath?: string;
    stderrPath?: string;
  }> = [];

  async run(
    command: string,
    args: string[],
    options: { cwd: string; stdinPath?: string; stdoutPath?: string; stderrPath?: string },
  ): Promise<{ exitCode: number }> {
    this.calls.push({ command, args, ...options });
    return { exitCode: 0 };
  }
}

function context() {
  return {
    runId: 'multi-agent',
    projectDir: '/tmp/project',
    runDir: '/tmp/run',
    artifactsDir: '/tmp/run/T1-project-setup',
  };
}

function passingFunctional(): FunctionalProbe {
  return {
    async run() {
      return [{ name: 'ok', pass: true }];
    },
  };
}
