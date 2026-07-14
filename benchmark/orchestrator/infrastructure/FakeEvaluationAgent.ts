import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { EvaluationCellSpec, KnownOrUnknown } from '../domain/evaluation';
import type {
  EvaluationCellExecution,
  EvaluationCellExecutor,
} from '../ports/EvaluationCellExecutor';

export class FakeEvaluationAgent implements EvaluationCellExecutor {
  constructor(private readonly command: string, private readonly args: string[]) {}

  async execute(input: {
    cell: EvaluationCellSpec;
    workspaceDir: string;
    submissionDir: string;
    prompt: string;
  }): Promise<EvaluationCellExecution> {
    const started = Date.now();
    const result = await runProcessTree(this.command, this.args, {
      cwd: input.workspaceDir,
      stdin: input.prompt,
      timeoutSeconds: input.cell.timeoutSeconds,
      env: {
        ...process.env,
        EVALUATION_WORKSPACE: input.workspaceDir,
        EVALUATION_SUBMISSION: input.submissionDir,
        EVALUATION_CELL_ID: input.cell.id,
      },
    });
    const metrics = await readMetrics(path.join(input.submissionDir, 'metrics.json'));
    return {
      ...result,
      wallMilliseconds: Date.now() - started,
      inputTokens: metric(metrics.values, 'inputTokens'),
      outputTokens: metric(metrics.values, 'outputTokens'),
      costUsd: metric(metrics.values, 'costUsd'),
      metricsReceipt: Buffer.from(`${JSON.stringify({ schemaVersion: 1, emitted: metrics.emitted, values: metrics.values ?? null })}\n`),
    };
  }
}

async function runProcessTree(
  command: string,
  args: string[],
  options: { cwd: string; stdin: string; timeoutSeconds: number; env: NodeJS.ProcessEnv },
): Promise<{ exitCode: number; timedOut: boolean; stdout: Buffer; stderr: Buffer }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      detached: process.platform !== 'win32',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      terminateTree(child.pid);
    }, options.timeoutSeconds * 1000);
    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
    child.on('error', reject);
    child.on('close', (code) => {
      clearTimeout(timer);
      terminateTree(child.pid);
      resolve({
        exitCode: timedOut ? 124 : code ?? 1,
        timedOut,
        stdout: Buffer.concat(stdout),
        stderr: Buffer.concat(stderr),
      });
    });
    child.stdin.end(options.stdin);
  });
}

function terminateTree(pid: number | undefined): void {
  if (!pid) return;
  try {
    if (process.platform === 'win32') {
      const killer = spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' });
      killer.unref();
    } else {
      process.kill(-pid, 'SIGKILL');
    }
  } catch {
    // The process group may already be gone.
  }
}

async function readMetrics(filePath: string): Promise<{
  emitted: boolean;
  values: Record<string, unknown> | undefined;
}> {
  let contents: string;
  try {
    contents = await readFile(filePath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { emitted: false, values: undefined };
    }
    throw error;
  }
  const parsed = JSON.parse(contents) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('fake-agent metrics.json must contain an object');
  }
  return { emitted: true, values: parsed as Record<string, unknown> };
}

function metric(record: Record<string, unknown> | undefined, name: string): KnownOrUnknown<number> {
  const value = record?.[name];
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? { status: 'known', value }
    : { status: 'unknown', reason: `${name} was not emitted by the fake agent` };
}
