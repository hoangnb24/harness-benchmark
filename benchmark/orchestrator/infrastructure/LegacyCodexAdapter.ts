import type {
  AgentAdapter,
  AgentInvocationContext,
  RawAgentOutput,
} from '../ports/AgentAdapter';
import type { TaskDefinition } from '../domain/task';

export interface CommandRunner {
  run(
    command: string,
    args: string[],
    options: {
      cwd: string;
      stdinPath?: string;
      stdoutPath?: string;
      stderrPath?: string;
      timeoutSeconds?: number;
    },
  ): Promise<{ exitCode: number }>;
}

export class LegacyCodexAdapter implements AgentAdapter {
  constructor(private readonly runner: CommandRunner) {}

  async invoke(task: TaskDefinition, context: AgentInvocationContext): Promise<RawAgentOutput> {
    const args = ['exec', '--json', '--color', 'never'];
    if (context.model) {
      args.push('--model', context.model);
    }
    args.push('-C', context.projectDir);

    const result = await this.runner.run(
      'codex',
      args,
      {
        cwd: context.projectDir,
        stdinPath: task.promptPath,
        stdoutPath: `${context.artifactsDir}/events.jsonl`,
        stderrPath: `${context.artifactsDir}/stderr.log`,
        timeoutSeconds: context.timeoutSeconds,
      },
    );

    return {
      exitCode: result.exitCode,
      eventsPath: `${context.artifactsDir}/events.jsonl`,
      stderrPath: `${context.artifactsDir}/stderr.log`,
    };
  }
}

export class ClaudeCodeAdapter implements AgentAdapter {
  constructor(private readonly runner: CommandRunner) {}

  async invoke(task: TaskDefinition, context: AgentInvocationContext): Promise<RawAgentOutput> {
    const stdoutPath = `${context.artifactsDir}/result.json`;
    const stderrPath = `${context.artifactsDir}/stderr.log`;
    const result = await this.runner.run('claude', ['--output-format', 'json'], {
      cwd: context.projectDir,
      stdinPath: task.promptPath,
      stdoutPath,
      stderrPath,
      timeoutSeconds: context.timeoutSeconds,
    });

    return {
      exitCode: result.exitCode,
      stdoutPath,
      stderrPath,
    };
  }
}

export class CustomAgentAdapter implements AgentAdapter {
  constructor(
    private readonly runner: CommandRunner,
    private readonly command: string,
    private readonly args: string[] = [],
  ) {}

  async invoke(task: TaskDefinition, context: AgentInvocationContext): Promise<RawAgentOutput> {
    const stdoutPath = `${context.artifactsDir}/usage.json`;
    const stderrPath = `${context.artifactsDir}/stderr.log`;
    const result = await this.runner.run(this.command, this.args, {
      cwd: context.projectDir,
      stdinPath: task.promptPath,
      stdoutPath,
      stderrPath,
      timeoutSeconds: context.timeoutSeconds,
    });

    return {
      exitCode: result.exitCode,
      stdoutPath,
      stderrPath,
    };
  }
}
