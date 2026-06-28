import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ClaudeCodeAdapter,
  CustomAgentAdapter,
  LegacyCodexAdapter,
  type CommandRunner,
} from '../infrastructure/LegacyCodexAdapter';
import { NodeCommandRunner } from '../infrastructure/NodeCommandRunner';
import { ShellHarnessInstaller } from '../infrastructure/ShellHarnessInstaller';
import { LegacyTaskArtifactRecorder } from '../infrastructure/LegacyTaskArtifactRecorder';
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
    const result = await new LegacyCodexAdapter(runner).invoke(
      task,
      context({ model: 'gpt-test', timeoutSeconds: 600 }),
    );

    expect(runner.calls[0]).toMatchObject({
      command: 'codex',
      args: ['exec', '--help'],
    });
    expect(runner.calls[1]).toMatchObject({
      command: 'codex',
      args: [
        'exec',
        '--sandbox',
        'danger-full-access',
        '--json',
        '--color',
        'never',
        '--model',
        'gpt-test',
        '-C',
        '/tmp/project',
      ],
      stdinPath: task.promptPath,
      stdoutPath: '/tmp/run/T1-project-setup/events.jsonl',
      timeoutSeconds: 600,
    });
    expect(result.eventsPath).toBe('/tmp/run/T1-project-setup/events.jsonl');
  });

  it('passes legacy Codex approval flag only when the CLI supports it', async () => {
    const runner = new RecordingCommandRunner(0, 'Usage: codex exec --ask-for-approval never');

    await new LegacyCodexAdapter(runner).invoke(task, context());

    expect(runner.calls[1].args).toContain('--ask-for-approval');
    expect(runner.calls[1].args).toContain('never');
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

describe('ShellHarnessInstaller', () => {
  it('delegates to the legacy prepare script with the requested harness ref', async () => {
    const runner = new RecordingCommandRunner();

    await new ShellHarnessInstaller(runner, '/repo/benchmark/lib/prepare.sh').install({
      harnessRef: 'feature/harness-cli',
      projectDir: '/tmp/project',
    });

    expect(runner.calls[0]).toMatchObject({
      command: 'bash',
      args: [
        '-c',
        'source "$1"; install_harness "$2" "$3"',
        'harness-install',
        '/repo/benchmark/lib/prepare.sh',
        'feature/harness-cli',
        '/tmp/project',
      ],
      cwd: '/tmp/project',
    });
  });

  it('fails when the prepare script command fails', async () => {
    const runner = new RecordingCommandRunner(1);

    await expect(
      new ShellHarnessInstaller(runner, '/repo/benchmark/lib/prepare.sh').install({
        harnessRef: 'bad-ref',
        projectDir: '/tmp/project',
      }),
    ).rejects.toThrow(/harness install failed for ref bad-ref/);
  });
});

describe('LegacyTaskArtifactRecorder', () => {
  it('marks functional artifacts as server startup failures when the probe reports startup diagnostics', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'legacy-artifacts-'));
    const scriptsDir = path.join(dir, 'scripts');
    const artifactsDir = path.join(dir, 'artifacts');
    await mkdir(scriptsDir, { recursive: true });
    await writeFile(
      path.join(scriptsDir, 'check-harness.sh'),
      'record_harness_baseline() { :; }\ncheck_harness() { :; }\n',
    );
    await writeFile(path.join(scriptsDir, 'check-quality.sh'), 'check_quality() { :; }\n');

    await new LegacyTaskArtifactRecorder(new NodeCommandRunner(), scriptsDir).afterTask({
      task,
      artifactsDir,
      projectDir: dir,
      startedAt: new Date('2026-06-25T00:00:00Z'),
      endedAt: new Date('2026-06-25T00:00:01Z'),
      exitCode: 0,
      functionalChecks: [
        {
          name: 'server_startup',
          pass: false,
          expected: 'server reachable',
          actual: 'server did not become reachable',
          diagnostic: 'server_startup',
        },
      ],
    });

    await expect(readJson(path.join(artifactsDir, 'functional.json'))).resolves.toMatchObject({
      server_started: false,
      error: 'server did not become reachable',
    });
  });
});

describe('NodeCommandRunner', () => {
  it('returns 124 when a command exceeds its timeout', async () => {
    const result = await new NodeCommandRunner().run(
      process.execPath,
      ['-e', 'setTimeout(() => {}, 1000)'],
      { cwd: process.cwd(), timeoutSeconds: 0.01 },
    );

    expect(result.exitCode).toBe(124);
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

  it('can assemble usage recording for Codex runs', async () => {
    const runDir = await mkdtemp(path.join(tmpdir(), 'composition-usage-'));
    const pricingPath = path.join(runDir, 'models.json');
    await writeFile(
      pricingPath,
      JSON.stringify({
        version: 'test',
        models: {
          'gpt-test': {
            provider: 'openai',
            input: 1,
            cachedInput: 0.1,
            output: 10,
            source: 'fixture',
            updatedAt: '2026-06-25',
          },
        },
      }),
    );

    const benchmark = buildRunner({
      agent: 'codex',
      commandRunner: new CodexUsageCommandRunner('gpt-test'),
      functional: passingFunctional(),
      model: 'gpt-test',
      pricingPath,
      pricingVersion: 'test',
      recordUsage: true,
    });

    await benchmark.run({ runId: 'usage-root', tasks: [task] }, { ...context(), runDir });

    await expect(readJson(path.join(runDir, task.id, 'usage.json'))).resolves.toMatchObject({
      provider: 'openai',
      pricingVersion: 'test',
      totals: { totalTokens: 125, costUsd: 0.000323 },
    });
    await expect(readJson(path.join(runDir, task.id, 'tokens.json'))).resolves.toMatchObject({
      total_tokens: 125,
      estimated_cost_usd: 0.000323,
    });
  });

  it('can assemble workspace snapshots for Codex runs', async () => {
    const workspaceDir = await mkdtemp(path.join(tmpdir(), 'composition-snapshot-workspace-'));
    const runDir = path.join(workspaceDir, 'benchmark/runs/snapshot-root');
    await writeFile(path.join(await ensureDir(path.join(workspaceDir, 'src')), 'index.ts'), 'v1');

    const benchmark = buildRunner({
      agent: 'codex',
      commandRunner: new RecordingCommandRunner(),
      functional: passingFunctional(),
      snapshotWorkspaces: true,
    });

    await benchmark.run(
      { runId: 'snapshot-root', tasks: [task] },
      { projectDir: workspaceDir, runDir },
    );

    await expect(
      readFile(path.join(runDir, 'checkpoints/pre-run/src/index.ts'), 'utf8'),
    ).resolves.toBe('v1');
    await expect(
      readFile(path.join(runDir, 'checkpoints/T1-project-setup/src/index.ts'), 'utf8'),
    ).resolves.toBe('v1');
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
    timeoutSeconds?: number;
  }> = [];

  constructor(
    private readonly exitCode = 0,
    private readonly stdout = '',
  ) {}

  async run(
    command: string,
    args: string[],
    options: {
      cwd: string;
      stdinPath?: string;
      stdoutPath?: string;
      stderrPath?: string;
      timeoutSeconds?: number;
    },
  ): Promise<{ exitCode: number }> {
    this.calls.push({ command, args, ...options });
    if (options.stdoutPath) {
      await mkdir(path.dirname(options.stdoutPath), { recursive: true });
      await writeFile(options.stdoutPath, this.stdout);
    }
    return { exitCode: this.exitCode };
  }
}

class CodexUsageCommandRunner implements CommandRunner {
  constructor(private readonly model: string) {}

  async run(
    _command: string,
    _args: string[],
    options: {
      cwd: string;
      stdinPath?: string;
      stdoutPath?: string;
      stderrPath?: string;
      timeoutSeconds?: number;
    },
  ): Promise<{ exitCode: number }> {
    if (!options.stdoutPath) {
      return { exitCode: 1 };
    }

    await mkdir(path.dirname(options.stdoutPath), { recursive: true });
    await writeFile(
      options.stdoutPath,
      `${JSON.stringify({
        type: 'turn.completed',
        model: this.model,
        usage: {
          input_tokens: 100,
          cached_input_tokens: 30,
          output_tokens: 25,
        },
      })}\n`,
    );
    return { exitCode: 0 };
  }
}

function context(
  overrides: Partial<ReturnType<typeof contextShape> & { model?: string; timeoutSeconds?: number }> = {},
) {
  return { ...contextShape(), ...overrides };
}

function contextShape() {
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

async function readJson(filePath: string): Promise<unknown> {
  return JSON.parse(await readFile(filePath, 'utf8')) as unknown;
}

async function ensureDir(dir: string): Promise<string> {
  await mkdir(dir, { recursive: true });
  return dir;
}
