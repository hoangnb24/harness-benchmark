import { createServer } from 'node:http';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { describe, expect, it } from 'vitest';
import { ServerManagedFunctionalProbe } from '../infrastructure/ServerManagedFunctionalProbe';
import type { TaskDefinition } from '../domain/task';
import type { FunctionalProbe } from '../ports/FunctionalProbe';

const task: TaskDefinition = {
  id: 'T1-project-setup',
  title: 'T1',
  promptPath: 'benchmark/tasks/T1-project-setup.md',
  rubricPath: 'benchmark/rubrics/T1-project-setup.md',
  expectedLane: 'tiny',
  dependencies: [],
  functionalCheckPath: 'benchmark/tasks/checks/T1-project-setup.json',
};

describe('ServerManagedFunctionalProbe', () => {
  it('replaces an existing reachable server before running benchmark checks', async () => {
    const port = await freePort();
    const baseUrl = `http://127.0.0.1:${port}`;
    const stale = startHealthServer(port, 'stale');
    await waitForHealth(baseUrl, 'stale');

    let healthBody = '';
    const inner: FunctionalProbe = {
      async run() {
        healthBody = await fetch(`${baseUrl}/health`).then((response) => response.text());
        return [{ name: 'owned_server', pass: healthBody === 'owned' }];
      },
    };

    const results = await new ServerManagedFunctionalProbe(inner, {
      baseUrl,
      startCommand: process.execPath,
      startArgs: ['-e', healthServerScript(port, 'owned')],
      startupTimeoutMs: 5_000,
    }).run(task, process.cwd());

    expect(results).toEqual([{ name: 'owned_server', pass: true }]);
    expect(healthBody).toBe('owned');
    await waitForExit(stale);
    expect(stale.exitCode !== null || stale.signalCode !== null).toBe(true);
  });

  it('returns a startup diagnostic when the managed server never becomes reachable', async () => {
    const port = await freePort();

    const results = await new ServerManagedFunctionalProbe(
      {
        async run() {
          return [{ name: 'should_not_run', pass: true }];
        },
      },
      {
        baseUrl: `http://127.0.0.1:${port}`,
        startCommand: process.execPath,
        startArgs: ['-e', 'process.exit(0)'],
        startupTimeoutMs: 100,
      },
    ).run(task, process.cwd());

    expect(results[0]).toMatchObject({
      name: 'server_startup',
      pass: false,
      diagnostic: 'server_startup',
    });
  });
});

async function freePort(): Promise<number> {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('failed to allocate port');
  }
  const port = address.port;
  server.close();
  await once(server, 'close');
  return port;
}

function startHealthServer(port: number, body: string): ChildProcess {
  return spawn(process.execPath, ['-e', healthServerScript(port, body)], {
    stdio: 'ignore',
    detached: process.platform !== 'win32',
  });
}

function healthServerScript(port: number, body: string): string {
  return [
    "const http = require('node:http');",
    `const body = ${JSON.stringify(body)};`,
    'const server = http.createServer((req, res) => {',
    "  if (req.url === '/health') {",
    '    res.writeHead(200, { "content-type": "text/plain" });',
    '    res.end(body);',
    '    return;',
    '  }',
    '  res.writeHead(404);',
    '  res.end();',
    '});',
    `server.listen(${port}, '127.0.0.1');`,
  ].join('\n');
}

async function waitForHealth(baseUrl: string, expected: string): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok && (await response.text()) === expected) {
        return;
      }
    } catch {
      // Keep polling until the child server is listening.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`server did not answer ${expected}`);
}

async function waitForExit(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  await once(child, 'close');
}
