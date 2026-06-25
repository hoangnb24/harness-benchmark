import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { GenerateReport } from '../application/GenerateReport';

const fixtureRunId = 'phase-5-evolution-infrastructure-20260608-230505';
const fixtureRunDir = path.join('benchmark', 'runs', fixtureRunId);

describe('GenerateReport', () => {
  it('reproduces the legacy scores.json for a golden run', async () => {
    const generator = new GenerateReport();
    const generated = await generator.generate(fixtureRunId, fixtureRunDir);
    const expectedScoresText = await readFile(path.join(fixtureRunDir, 'scores.json'), 'utf8');

    expect(generator.renderScoresJson(generated.scores)).toBe(expectedScoresText);
  });

  it('reproduces the legacy report.md when the generated date is fixed', async () => {
    const generator = new GenerateReport();
    const expectedReport = await readFile(path.join(fixtureRunDir, 'report.md'), 'utf8');
    const date = expectedReport.match(/\*\*Date\*\*: (.+)/)?.[1];

    expect(date).toBeDefined();

    const generated = await generator.generate(fixtureRunId, fixtureRunDir, new Date(date as string));
    expect(generated.reportMarkdown).toBe(expectedReport);
  });

  it('rolls up adherence scores additively when adherence artifacts exist', async () => {
    const runDir = path.join(tmpdir(), `adherence-report-${Date.now()}`);
    await mkdir(path.join(runDir, 'T1-example'), { recursive: true });
    await writeFile(
      path.join(runDir, 'metadata.json'),
      JSON.stringify({ harness_ref: 'main', agent: 'codex', model: 'gpt-test' }),
    );
    await writeJson(path.join(runDir, 'T1-example', 'timing.json'), { wall_seconds: 10 });
    await writeJson(path.join(runDir, 'T1-example', 'tokens.json'), {
      input_tokens: 100,
      output_tokens: 25,
      total_tokens: 125,
      estimated_cost_usd: 0.001,
    });
    await writeJson(path.join(runDir, 'T1-example', 'functional.json'), {
      checks: [{ pass: true }, { pass: false }],
    });
    await writeJson(path.join(runDir, 'T1-example', 'harness.json'), {
      checks: [{ pass: true }],
    });
    await writeJson(path.join(runDir, 'T1-example', 'quality.json'), {
      trace_quality_score: 2,
    });
    await writeJson(path.join(runDir, 'T1-example', 'lane.json'), {
      expected: 'tiny',
      actual: 'tiny',
    });
    await writeJson(path.join(runDir, 'T1-example', 'adherence.json'), {
      adherence_pass: 4,
      adherence_total: 6,
    });

    const generated = await new GenerateReport().generate(
      'adherence-run',
      runDir,
      new Date('2026-06-25T00:00:00Z'),
    );

    expect(generated.scores).toMatchObject({
      adherence_pass: 4,
      adherence_total: 6,
      adherence_pct: 66.6,
    });
    expect(new GenerateReport().renderScoresJson(generated.scores)).toContain('"adherence_pass": 4');
    expect(generated.reportMarkdown).toContain('| Harness adherence | 4/6 (66.6%) |');
  });

  it('prefers usage.json totals over legacy tokens.json when both exist', async () => {
    const runDir = path.join(tmpdir(), `usage-report-${Date.now()}`);
    await writeMinimalTask(runDir, 'T1-example');
    await writeJson(path.join(runDir, 'T1-example', 'tokens.json'), {
      input_tokens: 1,
      output_tokens: 1,
      total_tokens: 2,
      estimated_cost_usd: 1,
    });
    await writeJson(path.join(runDir, 'T1-example', 'usage.json'), {
      totals: {
        inputTokens: 100,
        cachedInputTokens: 25,
        outputTokens: 50,
        totalTokens: 175,
        costUsd: 0.25,
      },
    });

    const generated = await new GenerateReport().generate(
      'usage-run',
      runDir,
      new Date('2026-06-25T00:00:00Z'),
    );

    expect(generated.scores).toMatchObject({
      total_input_tokens: 125,
      total_output_tokens: 50,
      total_tokens: 175,
      estimated_total_cost_usd: 0.25,
    });
  });

  it('preserves unknown usage cost as null in scores and markdown', async () => {
    const runDir = path.join(tmpdir(), `usage-null-report-${Date.now()}`);
    await writeMinimalTask(runDir, 'T1-example');
    await writeJson(path.join(runDir, 'T1-example', 'usage.json'), {
      totals: {
        inputTokens: 100,
        cachedInputTokens: 0,
        outputTokens: 50,
        totalTokens: 150,
        costUsd: null,
      },
    });

    const generator = new GenerateReport();
    const generated = await generator.generate(
      'usage-null-run',
      runDir,
      new Date('2026-06-25T00:00:00Z'),
    );

    expect(generated.scores.estimated_total_cost_usd).toBeNull();
    expect(generator.renderScoresJson(generated.scores)).toContain(
      '"estimated_total_cost_usd": null',
    );
    expect(generated.reportMarkdown).toContain('| Estimated cost | unknown |');
  });
});

async function writeJson(filePath: string, value: unknown) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(value));
}

async function writeMinimalTask(runDir: string, taskName: string) {
  await mkdir(path.join(runDir, taskName), { recursive: true });
  await writeJson(path.join(runDir, 'metadata.json'), {
    harness_ref: 'main',
    agent: 'codex',
    model: 'gpt-test',
  });
  await writeJson(path.join(runDir, taskName, 'timing.json'), { wall_seconds: 1 });
  await writeJson(path.join(runDir, taskName, 'functional.json'), { checks: [{ pass: true }] });
  await writeJson(path.join(runDir, taskName, 'harness.json'), { checks: [{ pass: true }] });
  await writeJson(path.join(runDir, taskName, 'quality.json'), { trace_quality_score: 1 });
  await writeJson(path.join(runDir, taskName, 'lane.json'), {
    expected: 'tiny',
    actual: 'tiny',
  });
}
