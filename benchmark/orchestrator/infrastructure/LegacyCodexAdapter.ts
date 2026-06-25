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
    options: { cwd: string; stdinPath?: string; stdoutPath?: string; stderrPath?: string },
  ): Promise<{ exitCode: number }>;
}

export class LegacyCodexAdapter implements AgentAdapter {
  constructor(private readonly runner: CommandRunner) {}

  async invoke(task: TaskDefinition, context: AgentInvocationContext): Promise<RawAgentOutput> {
    const result = await this.runner.run(
      'codex',
      ['exec', '--json', '--color', 'never', '-C', context.projectDir],
      {
        cwd: context.projectDir,
        stdinPath: task.promptPath,
        stdoutPath: `${context.artifactsDir}/events.jsonl`,
        stderrPath: `${context.artifactsDir}/stderr.log`,
      },
    );

    return {
      exitCode: result.exitCode,
      eventsPath: `${context.artifactsDir}/events.jsonl`,
      stderrPath: `${context.artifactsDir}/stderr.log`,
    };
  }
}
