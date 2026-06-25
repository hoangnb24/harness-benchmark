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
});

async function writeJson(filePath: string, value: unknown) {
  await writeFile(filePath, JSON.stringify(value));
}
