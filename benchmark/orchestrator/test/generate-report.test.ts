import { readFile } from 'node:fs/promises';
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
});
