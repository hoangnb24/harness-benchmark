import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { CommandRunner } from './LegacyCodexAdapter';
import type {
  AfterTaskArtifactsInput,
  BeforeTaskArtifactsInput,
  TaskArtifactRecorder,
} from '../ports/TaskArtifactRecorder';

export class LegacyTaskArtifactRecorder implements TaskArtifactRecorder {
  constructor(
    private readonly runner: CommandRunner,
    private readonly scriptsDir = path.resolve('benchmark/lib'),
  ) {}

  async beforeTask(input: BeforeTaskArtifactsInput): Promise<void> {
    await mkdir(input.artifactsDir, { recursive: true });
    await this.runLegacyFunction('check-harness.sh', 'record_harness_baseline', [
      input.artifactsDir,
      input.projectDir,
    ]);
  }

  async afterTask(input: AfterTaskArtifactsInput): Promise<void> {
    await mkdir(input.artifactsDir, { recursive: true });
    await Promise.all([
      writeJson(path.join(input.artifactsDir, 'timing.json'), {
        start: formatDate(input.startedAt),
        end: formatDate(input.endedAt),
        wall_seconds: Math.max(
          0,
          Math.floor((input.endedAt.getTime() - input.startedAt.getTime()) / 1000),
        ),
        exit_code: input.exitCode,
        timed_out: input.exitCode === 124,
      }),
      writeJson(path.join(input.artifactsDir, 'functional.json'), {
        server_started: serverStarted(input.functionalChecks),
        ...functionalError(input.functionalChecks),
        checks: input.functionalChecks,
      }),
    ]);

    await this.runLegacyFunction('check-harness.sh', 'check_harness', [
      input.task.id,
      input.artifactsDir,
      input.projectDir,
    ]);
    await this.runLegacyFunction('check-quality.sh', 'check_quality', [
      input.task.id,
      input.artifactsDir,
      input.projectDir,
    ]);
  }

  private async runLegacyFunction(
    scriptName: string,
    functionName: string,
    args: string[],
  ): Promise<void> {
    await this.runner.run(
      'bash',
      ['-c', 'source "$1"; shift; "$@"', 'legacy-artifact', path.join(this.scriptsDir, scriptName), functionName, ...args],
      { cwd: process.cwd() },
    );
  }
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function formatDate(date: Date): string {
  return date.toISOString();
}

function serverStarted(checks: AfterTaskArtifactsInput['functionalChecks']): boolean {
  return !checks.some((check) => check.diagnostic === 'server_startup');
}

function functionalError(
  checks: AfterTaskArtifactsInput['functionalChecks'],
): { error?: string | number } {
  const startupFailure = checks.find((check) => check.diagnostic === 'server_startup');
  return startupFailure?.actual === undefined ? {} : { error: startupFailure.actual };
}
