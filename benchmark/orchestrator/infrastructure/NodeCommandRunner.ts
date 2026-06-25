import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import type { CommandRunner } from './LegacyCodexAdapter';

export class NodeCommandRunner implements CommandRunner {
  async run(
    command: string,
    args: string[],
    options: { cwd: string; stdinPath?: string; stdoutPath?: string; stderrPath?: string },
  ): Promise<{ exitCode: number }> {
    const input = options.stdinPath ? await readFile(options.stdinPath) : undefined;

    return new Promise((resolve, reject) => {
      const child = spawn(command, args, { cwd: options.cwd, stdio: ['pipe', 'pipe', 'pipe'] });
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];

      child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
      child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
      child.on('error', reject);
      child.on('close', async (code) => {
        try {
          await writeOutputs(options, Buffer.concat(stdout), Buffer.concat(stderr));
          resolve({ exitCode: code ?? 1 });
        } catch (error) {
          reject(error);
        }
      });

      if (input) {
        child.stdin.end(input);
      } else {
        child.stdin.end();
      }
    });
  }
}

async function writeOutputs(
  options: { stdoutPath?: string; stderrPath?: string },
  stdout: Buffer,
  stderr: Buffer,
): Promise<void> {
  await Promise.all([
    writeOptional(options.stdoutPath, stdout),
    writeOptional(options.stderrPath, stderr),
  ]);
}

async function writeOptional(filePath: string | undefined, contents: Buffer): Promise<void> {
  if (!filePath) {
    return;
  }

  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, contents);
}
