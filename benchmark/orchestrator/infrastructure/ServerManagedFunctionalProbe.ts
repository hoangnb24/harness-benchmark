import { spawn, type ChildProcess } from 'node:child_process';
import type { TaskDefinition } from '../domain/task';
import type { CheckResult, FunctionalProbe } from '../ports/FunctionalProbe';

export class ServerManagedFunctionalProbe implements FunctionalProbe {
  constructor(
    private readonly inner: FunctionalProbe,
    private readonly options: {
      baseUrl: string;
      startCommand?: string;
      startArgs?: string[];
      startupTimeoutMs?: number;
    },
  ) {}

  async run(task: TaskDefinition, projectDir: string): Promise<CheckResult[]> {
    if (!task.functionalCheckPath) {
      return this.inner.run(task, projectDir);
    }

    if (await isReachable(this.options.baseUrl)) {
      return this.inner.run(task, projectDir);
    }

    const server = this.start(projectDir);
    try {
      await waitForServer(this.options.baseUrl, this.options.startupTimeoutMs ?? 15_000);
      return await this.inner.run(task, projectDir);
    } finally {
      stop(server);
    }
  }

  private start(projectDir: string): ChildProcess {
    const command = this.options.startCommand ?? 'npm';
    const args = this.options.startArgs ?? ['run', 'dev'];
    return spawn(command, args, {
      cwd: projectDir,
      detached: process.platform !== 'win32',
      stdio: 'ignore',
    });
  }
}

async function waitForServer(baseUrl: string, timeoutMs: number): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await isReachable(baseUrl)) {
      return;
    }
    await sleep(250);
  }

  throw new Error(`server did not become reachable at ${baseUrl} within ${timeoutMs}ms`);
}

async function isReachable(baseUrl: string): Promise<boolean> {
  try {
    const response = await fetch(`${baseUrl}/health`);
    return response.ok;
  } catch {
    return false;
  }
}

function stop(server: ChildProcess): void {
  if (!server.pid) {
    return;
  }

  if (process.platform === 'win32') {
    server.kill('SIGTERM');
    return;
  }

  try {
    process.kill(-server.pid, 'SIGTERM');
  } catch {
    server.kill('SIGTERM');
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
