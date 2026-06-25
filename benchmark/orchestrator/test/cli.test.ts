import { mkdtemp, writeFile } from 'node:fs/promises';
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
});
