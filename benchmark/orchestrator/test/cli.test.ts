import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { runCli } from '../interface/cli';

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
  });

  it('generates scores and markdown reports from a run directory', async () => {
    const runDir = await mkdtemp(path.join(tmpdir(), 'cli-report-'));
    await writeMinimalTask(runDir, 'T1-example');

    let stdout = '';
    const code = await runCli(
      ['report', 'generate', '--run-id', 'cli-report', '--run-dir', runDir],
      {
        stdout: (message) => {
          stdout += message;
        },
        stderr: () => {},
      },
    );

    expect(code).toBe(0);
    expect(stdout).toContain('Report generated:');
    await expect(readFile(path.join(runDir, 'scores.json'), 'utf8')).resolves.toContain(
      '"run_id": "cli-report"',
    );
    await expect(readFile(path.join(runDir, 'report.md'), 'utf8')).resolves.toContain(
      '# Benchmark Report: cli-report',
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
