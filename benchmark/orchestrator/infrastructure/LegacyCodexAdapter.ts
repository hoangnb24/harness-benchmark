import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
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
    const args = ['exec', '--sandbox', 'danger-full-access', '--json', '--color', 'never'];
    if (await this.supportsAskForApproval(context.projectDir)) {
      args.push('--ask-for-approval', 'never');
    }
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

  private async supportsAskForApproval(cwd: string): Promise<boolean> {
    const tempDir = await mkdtemp(path.join(tmpdir(), 'codex-help-'));
    const stdoutPath = path.join(tempDir, 'stdout.txt');
    try {
      const result = await this.runner.run('codex', ['exec', '--help'], {
        cwd,
        stdoutPath,
        timeoutSeconds: 10,
      });
      if (result.exitCode !== 0) {
        return false;
      }

      return (await readFile(stdoutPath, 'utf8')).includes('--ask-for-approval');
    } catch {
      return false;
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
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
