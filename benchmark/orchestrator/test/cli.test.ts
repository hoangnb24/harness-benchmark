import { chmod, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { runCli } from '../interface/cli';

const execFileAsync = promisify(execFile);

describe('CLI', () => {
  it('validates a pricing table and prints effective rates', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'cli-pricing-'));
    const pricingPath = path.join(dir, 'models.json');
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

    let stdout = '';
    let stderr = '';
    const code = await runCli(['pricing', 'validate', '--pricing', pricingPath], {
      stdout: (message) => {
        stdout += message;
      },
      stderr: (message) => {
        stderr += message;
      },
    });

    expect(code).toBe(0);
    expect(stderr).toBe('');
    expect(stdout).toContain('Pricing table OK');
    expect(stdout).toContain('gpt-test (openai) input=1 cached=0.1 output=10');
  });

  it('fails validation for malformed pricing JSON', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'cli-pricing-bad-'));
    const pricingPath = path.join(dir, 'models.json');
    await writeFile(pricingPath, '{not json');

    let stderr = '';
    const code = await runCli(['pricing', 'validate', '--pricing', pricingPath], {
      stdout: () => {},
      stderr: (message) => {
        stderr += message;
      },
    });

    expect(code).toBe(1);
    expect(stderr).toContain('Pricing table invalid');
    expect(stderr).toContain(`invalid pricing JSON in ${pricingPath}`);
  });

  it('generates scores and markdown reports from a run directory', async () => {
    const runDir = await mkdtemp(path.join(tmpdir(), 'cli-report-'));
    await writeMinimalTask(runDir, 'T1-example');

    let stdout = '';
    let stderr = '';
    const code = await runCli(
      ['report', 'generate', '--run-id', 'cli-report', '--run-dir', runDir],
      {
        stdout: (message) => {
          stdout += message;
        },
        stderr: (message) => {
          stderr += message;
        },
      },
    );

    expect(code, stderr).toBe(0);
    expect(stdout).toContain('Report generated:');
    await expect(readFile(path.join(runDir, 'scores.json'), 'utf8')).resolves.toContain(
      '"run_id": "cli-report"',
    );
    await expect(readFile(path.join(runDir, 'report.md'), 'utf8')).resolves.toContain(
      '# Benchmark Report: cli-report',
    );
  });

  it('executes a one-task run through the CLI', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'cli-execute-'));
    const workspaceDir = path.join(dir, 'workspace');
    const runDir = path.join(dir, 'run');
    const manifestPath = path.join(dir, 'manifest.json');
    const pricingPath = path.join(dir, 'models.json');
    const agentPath = path.join(dir, 'fake-agent');

    await mkdir(workspaceDir, { recursive: true });
    await writeText(path.join(workspaceDir, 'src/index.ts'), 'initial source');
    await writeFile(path.join(dir, 'prompt.md'), 'Build the thing');
    await writeJson(manifestPath, {
      version: 1,
      tasks: [
        {
          id: 'T1-fixture',
          title: 'Fixture',
          promptPath: path.join(dir, 'prompt.md'),
          rubricPath: path.join(dir, 'rubric.md'),
          expectedLane: 'normal',
        },
      ],
    });
    await writeJson(pricingPath, {
      version: 'test',
      models: {
        'gpt-test': {
          provider: 'custom',
          input: 1,
          cachedInput: 0.1,
          output: 10,
          source: 'fixture',
          updatedAt: '2026-06-25',
        },
      },
    });
    await writeFile(
      agentPath,
      '#!/bin/sh\n' +
        'echo \'{"provider":"custom","interactions":[{"model":"gpt-test","inputTokens":100,"cachedInputTokens":0,"outputTokens":25}]}\'\n',
    );
    await chmod(agentPath, 0o755);

    let stdout = '';
    let stderr = '';
    const code = await runCli(
      [
        'run',
        '--execute',
        '--run-id',
        'execute-fixture',
        '--run-dir',
        runDir,
        '--workspace',
        workspaceDir,
        '--manifest',
        manifestPath,
        '--agent',
        'custom',
        '--agent-cmd',
        agentPath,
        '--model',
        'gpt-test',
        '--pricing',
        pricingPath,
        '--skip-harness-install',
      ],
      {
        stdout: (message) => {
          stdout += message;
        },
        stderr: (message) => {
          stderr += message;
        },
      },
    );

    expect(code, stderr).toBe(0);
    expect(stdout).toContain('Executed run execute-fixture: 1 tasks');
    await expect(readFile(path.join(runDir, 'state.json'), 'utf8')).resolves.toContain(
      '"status": "passed"',
    );
    await expect(
      readFile(path.join(runDir, 'T1-fixture', 'usage.json'), 'utf8'),
    ).resolves.toContain('"costUsd": 0.00035');
    await expect(
      readFile(path.join(runDir, 'checkpoints/pre-run/src/index.ts'), 'utf8'),
    ).resolves.toBe('initial source');
    await expect(readFile(path.join(runDir, 'scores.json'), 'utf8')).resolves.toContain(
      '"run_id": "execute-fixture"',
    );
    await expect(readFile(path.join(runDir, 'report.md'), 'utf8')).resolves.toContain(
      '# Benchmark Report: execute-fixture',
    );
    await expect(readFile(path.join(runDir, 'T1-fixture', 'timing.json'), 'utf8')).resolves.toContain(
      '"exit_code": 0',
    );
    await expect(readFile(path.join(runDir, 'T1-fixture', 'functional.json'), 'utf8')).resolves.toContain(
      '"checks": []',
    );
  });

  it('resumes an executed run from the first failed task with checkpoint restore', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'cli-resume-execute-'));
    const workspaceDir = path.join(dir, 'workspace');
    const runDir = path.join(dir, 'run');
    const manifestPath = path.join(dir, 'manifest.json');
    const pricingPath = path.join(dir, 'models.json');
    const agentPath = path.join(dir, 'fake-agent.js');
    const invocationLogPath = path.join(dir, 'invocations.log');
    const allowT3Path = path.join(dir, 'allow-t3');

    await mkdir(workspaceDir, { recursive: true });
    await writeText(path.join(workspaceDir, 'src/index.ts'), 'initial source');
    await writeText(path.join(dir, 'prompt-t1.md'), 'TASK T1');
    await writeText(path.join(dir, 'prompt-t2.md'), 'TASK T2');
    await writeText(path.join(dir, 'prompt-t3.md'), 'TASK T3');
    await writeJson(manifestPath, {
      version: 1,
      tasks: [
        {
          id: 'T1-fixture',
          title: 'Fixture 1',
          promptPath: path.join(dir, 'prompt-t1.md'),
          rubricPath: path.join(dir, 'rubric.md'),
          expectedLane: 'normal',
        },
        {
          id: 'T2-fixture',
          title: 'Fixture 2',
          promptPath: path.join(dir, 'prompt-t2.md'),
          rubricPath: path.join(dir, 'rubric.md'),
          expectedLane: 'normal',
          dependencies: ['T1-fixture'],
        },
        {
          id: 'T3-fixture',
          title: 'Fixture 3',
          promptPath: path.join(dir, 'prompt-t3.md'),
          rubricPath: path.join(dir, 'rubric.md'),
          expectedLane: 'normal',
          dependencies: ['T2-fixture'],
        },
      ],
    });
    await writeJson(pricingPath, {
      version: 'test',
      models: {
        'gpt-test': {
          provider: 'custom',
          input: 1,
          cachedInput: 0.1,
          output: 10,
          source: 'fixture',
          updatedAt: '2026-06-25',
        },
      },
    });
    await writeFakeResumeAgent(agentPath, invocationLogPath, allowT3Path);

    const initialCode = await runCli(
      [
        'run',
        '--execute',
        '--run-id',
        'resume-execute-fixture',
        '--run-dir',
        runDir,
        '--workspace',
        workspaceDir,
        '--manifest',
        manifestPath,
        '--agent',
        'custom',
        '--agent-cmd',
        agentPath,
        '--model',
        'gpt-test',
        '--pricing',
        pricingPath,
        '--skip-harness-install',
        '--skip-scoring-artifacts',
      ],
      {
        stdout: () => {},
        stderr: () => {},
      },
    );

    expect(initialCode).toBe(0);
    await expect(readFile(path.join(runDir, 'state.json'), 'utf8')).resolves.toContain(
      '"status": "failed"',
    );
    await expect(readFile(path.join(runDir, 'state.json'), 'utf8')).resolves.toContain(
      '"exitCode": 124',
    );
    await expect(
      readFile(path.join(runDir, 'checkpoints/T2-fixture/src/index.ts'), 'utf8'),
    ).resolves.toBe('two');

    await writeText(path.join(workspaceDir, 'src/index.ts'), 'dirty after failed T3');
    await writeText(allowT3Path, 'ok');

    let stdout = '';
    let stderr = '';
    const resumeCode = await runCli(
      [
        'run',
        '--execute',
        '--resume',
        'resume-execute-fixture',
        '--run-dir',
        runDir,
        '--workspace',
        workspaceDir,
        '--manifest',
        manifestPath,
        '--agent',
        'custom',
        '--agent-cmd',
        agentPath,
        '--model',
        'gpt-test',
        '--pricing',
        pricingPath,
        '--skip-harness-install',
        '--skip-scoring-artifacts',
      ],
      {
        stdout: (message) => {
          stdout += message;
        },
        stderr: (message) => {
          stderr += message;
        },
      },
    );

    expect(resumeCode, stderr).toBe(0);
    expect(stdout).toContain('Executed run resume-execute-fixture: 1 tasks');
    await expect(readFile(path.join(workspaceDir, 'src/index.ts'), 'utf8')).resolves.toBe('three');
    await expect(readFile(invocationLogPath, 'utf8')).resolves.toBe(
      ['TASK T1', 'TASK T2', 'TASK T3', 'TASK T3', ''].join('\n'),
    );
    await expect(readFile(path.join(runDir, 'state.json'), 'utf8')).resolves.toContain(
      '"checkpoint": "checkpoints/T3-fixture"',
    );
  });

  it('installs the requested harness ref before executing a fresh run', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'cli-harness-install-'));
    const workspaceDir = path.join(dir, 'workspace');
    const runDir = path.join(dir, 'run');
    const manifestPath = path.join(dir, 'manifest.json');
    const pricingPath = path.join(dir, 'models.json');
    const agentPath = path.join(dir, 'fake-agent.js');
    const preparePath = path.join(dir, 'prepare.sh');
    const orderPath = path.join(dir, 'order.log');

    await mkdir(workspaceDir, { recursive: true });
    await writeText(path.join(workspaceDir, 'src/index.ts'), 'initial source');
    await writeText(path.join(dir, 'prompt.md'), 'TASK T1');
    await writeJson(manifestPath, {
      version: 1,
      tasks: [
        {
          id: 'T1-fixture',
          title: 'Fixture',
          promptPath: path.join(dir, 'prompt.md'),
          rubricPath: path.join(dir, 'rubric.md'),
          expectedLane: 'normal',
        },
      ],
    });
    await writeJson(pricingPath, {
      version: 'test',
      models: {
        'gpt-test': {
          provider: 'custom',
          input: 1,
          cachedInput: 0.1,
          output: 10,
          source: 'fixture',
          updatedAt: '2026-06-25',
        },
      },
    });
    await writeFile(
      preparePath,
      [
        'install_harness() {',
        `  printf 'install:%s:%s\\n' "$1" "$2" >> ${JSON.stringify(orderPath)}`,
        '  mkdir -p "$2/scripts/bin"',
        '  printf "#!/bin/sh\\necho fake harness cli\\n" > "$2/scripts/bin/harness-cli"',
        '  chmod 755 "$2/scripts/bin/harness-cli"',
        '}',
        '',
      ].join('\n'),
    );
    await writeFile(
      agentPath,
      [
        '#!/usr/bin/env node',
        "const fs = require('node:fs');",
        "const path = require('node:path');",
        `fs.appendFileSync(${JSON.stringify(orderPath)}, 'agent\\n');`,
        "fs.writeFileSync(path.join(process.cwd(), 'src/index.ts'), 'after agent');",
        "console.log('{\"provider\":\"custom\",\"interactions\":[{\"model\":\"gpt-test\",\"inputTokens\":100,\"cachedInputTokens\":0,\"outputTokens\":25}]}');",
        '',
      ].join('\n'),
    );
    await chmod(agentPath, 0o755);

    let stdout = '';
    let stderr = '';
    const code = await runCli(
      [
        'run',
        '--execute',
        '--run-id',
        'install-fixture',
        '--run-dir',
        runDir,
        '--workspace',
        workspaceDir,
        '--manifest',
        manifestPath,
        '--agent',
        'custom',
        '--agent-cmd',
        agentPath,
        '--model',
        'gpt-test',
        '--pricing',
        pricingPath,
        '--harness',
        'feature/harness-cli',
        '--harness-prepare-script',
        preparePath,
        '--skip-scoring-artifacts',
      ],
      {
        stdout: (message) => {
          stdout += message;
        },
        stderr: (message) => {
          stderr += message;
        },
      },
    );

    expect(code, stderr).toBe(0);
    expect(stdout).toContain('Installing harness from feature/harness-cli');
    await expect(readFile(orderPath, 'utf8')).resolves.toBe(
      `install:feature/harness-cli:${workspaceDir}\nagent\n`,
    );
    await expect(readFile(path.join(runDir, 'metadata.json'), 'utf8')).resolves.toContain(
      '"harness_ref": "feature/harness-cli"',
    );
    await expect(
      readFile(path.join(runDir, 'checkpoints/pre-run/scripts/bin/harness-cli'), 'utf8'),
    ).resolves.toContain('fake harness cli');
  });

  it('isolates fresh git workspace executions and copies back run artifacts', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'cli-isolated-run-'));
    const workspaceDir = path.join(dir, 'workspace');
    const runDir = path.join(workspaceDir, 'benchmark/runs/isolated-fixture');
    const manifestPath = path.join(workspaceDir, 'benchmark/tasks/manifest.json');
    const pricingPath = path.join(workspaceDir, 'benchmark/pricing/models.json');
    const agentPath = path.join(dir, 'fake-agent.js');

    await mkdir(path.join(workspaceDir, 'src'), { recursive: true });
    await mkdir(path.dirname(manifestPath), { recursive: true });
    await mkdir(path.dirname(pricingPath), { recursive: true });
    await writeText(path.join(workspaceDir, 'src/index.ts'), 'original source');
    await writeText(path.join(workspaceDir, 'benchmark/tasks/prompt.md'), 'TASK T1');
    await writeJson(manifestPath, {
      version: 1,
      tasks: [
        {
          id: 'T1-fixture',
          title: 'Fixture',
          promptPath: path.join(workspaceDir, 'benchmark/tasks/prompt.md'),
          rubricPath: path.join(workspaceDir, 'benchmark/rubrics/T1.md'),
          expectedLane: 'normal',
        },
      ],
    });
    await writeJson(pricingPath, {
      version: 'test',
      models: {
        'gpt-test': {
          provider: 'custom',
          input: 1,
          cachedInput: 0.1,
          output: 10,
          source: 'fixture',
          updatedAt: '2026-06-25',
        },
      },
    });
    await writeFile(
      agentPath,
      [
        '#!/usr/bin/env node',
        "const fs = require('node:fs');",
        "const path = require('node:path');",
        "fs.writeFileSync(path.join(process.cwd(), 'src/index.ts'), 'changed in isolation');",
        "console.log('{\"provider\":\"custom\",\"interactions\":[{\"model\":\"gpt-test\",\"inputTokens\":100,\"cachedInputTokens\":0,\"outputTokens\":25}]}');",
        '',
      ].join('\n'),
    );
    await chmod(agentPath, 0o755);
    await execFileAsync('git', ['init'], { cwd: workspaceDir });
    await execFileAsync('git', ['add', '.'], { cwd: workspaceDir });
    await execFileAsync(
      'git',
      ['-c', 'user.email=test@example.com', '-c', 'user.name=Test User', 'commit', '-m', 'seed'],
      { cwd: workspaceDir },
    );

    let stdout = '';
    let stderr = '';
    const code = await runCli(
      [
        'run',
        '--execute',
        '--run-id',
        'isolated-fixture',
        '--run-dir',
        runDir,
        '--workspace',
        workspaceDir,
        '--manifest',
        manifestPath,
        '--agent',
        'custom',
        '--agent-cmd',
        agentPath,
        '--model',
        'gpt-test',
        '--pricing',
        pricingPath,
        '--skip-harness-install',
        '--skip-scoring-artifacts',
      ],
      {
        stdout: (message) => {
          stdout += message;
        },
        stderr: (message) => {
          stderr += message;
        },
      },
    );

    expect(code, stderr).toBe(0);
    expect(stdout).toContain('Preparing isolated benchmark workspace:');
    expect(stdout).toContain(`Isolated run copied back: ${runDir}`);
    await expect(readFile(path.join(workspaceDir, 'src/index.ts'), 'utf8')).resolves.toBe(
      'original source',
    );
    await expect(readFile(path.join(runDir, 'state.json'), 'utf8')).resolves.toContain(
      '"status": "passed"',
    );
  });
});

async function writeMinimalTask(runDir: string, taskName: string) {
  await mkdir(path.join(runDir, taskName), { recursive: true });
  await writeJson(path.join(runDir, 'metadata.json'), {
    harness_ref: 'main',
    agent: 'codex',
    model: 'gpt-test',
  });
  await writeJson(path.join(runDir, taskName, 'timing.json'), { wall_seconds: 1 });
  await writeJson(path.join(runDir, taskName, 'tokens.json'), {
    input_tokens: 10,
    output_tokens: 5,
    total_tokens: 15,
    estimated_cost_usd: 0.01,
  });
  await writeJson(path.join(runDir, taskName, 'functional.json'), { checks: [{ pass: true }] });
  await writeJson(path.join(runDir, taskName, 'harness.json'), { checks: [{ pass: true }] });
  await writeJson(path.join(runDir, taskName, 'quality.json'), { trace_quality_score: 1 });
  await writeJson(path.join(runDir, taskName, 'lane.json'), {
    expected: 'tiny',
    actual: 'tiny',
  });
}

async function writeJson(filePath: string, value: unknown) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(value));
}

async function writeText(filePath: string, value: string) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, value);
}

async function writeFakeResumeAgent(
  agentPath: string,
  invocationLogPath: string,
  allowT3Path: string,
) {
  await writeFile(
    agentPath,
    [
      '#!/usr/bin/env node',
      "const fs = require('node:fs');",
      "const path = require('node:path');",
      "const prompt = fs.readFileSync(0, 'utf8').trim();",
      `fs.appendFileSync(${JSON.stringify(invocationLogPath)}, prompt + '\\n');`,
      "fs.mkdirSync(path.join(process.cwd(), 'src'), { recursive: true });",
      "if (prompt.includes('T1')) {",
      "  fs.writeFileSync(path.join(process.cwd(), 'src/index.ts'), 'one');",
      "} else if (prompt.includes('T2')) {",
      "  fs.writeFileSync(path.join(process.cwd(), 'src/index.ts'), 'two');",
      "} else if (prompt.includes('T3')) {",
      `  if (!fs.existsSync(${JSON.stringify(allowT3Path)})) {`,
      "    fs.writeFileSync(path.join(process.cwd(), 'src/index.ts'), 'failed-three');",
      "    console.error('timeout');",
      "    process.exit(124);",
      '  }',
      "  if (fs.readFileSync(path.join(process.cwd(), 'src/index.ts'), 'utf8') !== 'two') {",
      "    console.error('workspace was not restored from T2 checkpoint');",
      '    process.exit(1);',
      '  }',
      "  fs.writeFileSync(path.join(process.cwd(), 'src/index.ts'), 'three');",
      '}',
      "console.log('{\"provider\":\"custom\",\"interactions\":[{\"model\":\"gpt-test\",\"inputTokens\":100,\"cachedInputTokens\":0,\"outputTokens\":25}]}');",
      '',
    ].join('\n'),
  );
  await chmod(agentPath, 0o755);
}
