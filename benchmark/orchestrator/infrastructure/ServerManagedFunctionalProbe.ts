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
      reuseExistingServer?: boolean;
    },
  ) {}

  async run(task: TaskDefinition, projectDir: string): Promise<CheckResult[]> {
    if (!task.functionalCheckPath) {
      return this.inner.run(task, projectDir);
    }

    if (await isReachable(this.options.baseUrl) && this.options.reuseExistingServer === true) {
      return this.inner.run(task, projectDir);
    }

    if (await isReachable(this.options.baseUrl)) {
      await stopExistingServer(this.options.baseUrl);
    }

    let server: ChildProcess;
    try {
      server = this.start(projectDir);
    } catch (error) {
      return [startupFailure(error)];
    }

    try {
      await waitForServer(this.options.baseUrl, this.options.startupTimeoutMs ?? 15_000);
      return await this.inner.run(task, projectDir);
    } catch (error) {
      return [startupFailure(error)];
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

async function stopExistingServer(baseUrl: string): Promise<void> {
  const port = portFromBaseUrl(baseUrl);
  if (!port) {
    throw new Error(`cannot determine server port from ${baseUrl}`);
  }

  const pids = await pidsForPort(port);
  for (const pid of pids) {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      // The process may already have exited between lsof and kill.
    }
  }

  const stoppedAt = Date.now() + 5_000;
  while (Date.now() < stoppedAt) {
    if (!(await isReachable(baseUrl))) {
      return;
    }
    await sleep(100);
  }

  throw new Error(`existing server still reachable at ${baseUrl}`);
}

async function pidsForPort(port: string): Promise<number[]> {
  return new Promise((resolve) => {
    const child = spawn('lsof', ['-tiTCP:' + port, '-sTCP:LISTEN'], {
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const stdout: Buffer[] = [];

    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.on('error', () => resolve([]));
    child.on('close', () => {
      resolve(
        Buffer.concat(stdout)
          .toString('utf8')
          .split(/\r?\n/)
          .map((line) => Number(line.trim()))
          .filter((pid) => Number.isInteger(pid) && pid > 0),
      );
    });
  });
}

function portFromBaseUrl(baseUrl: string): string | undefined {
  const url = new URL(baseUrl);
  if (url.port) {
    return url.port;
  }
  if (url.protocol === 'http:') {
    return '80';
  }
  if (url.protocol === 'https:') {
    return '443';
  }
  return undefined;
}

function startupFailure(error: unknown): CheckResult {
  return {
    name: 'server_startup',
    pass: false,
    expected: 'server reachable',
    actual: error instanceof Error ? error.message : String(error),
    diagnostic: 'server_startup',
  };
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
