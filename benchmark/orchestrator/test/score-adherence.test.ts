import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ScoreAdherence } from '../application/ScoreAdherence';
import type { AdherenceEvidence } from '../domain/adherence';
import { FsAdherenceArtifactWriter } from '../infrastructure/FsAdherenceArtifactWriter';
import { JsonAdherenceEvidenceProvider } from '../infrastructure/JsonAdherenceEvidenceProvider';
import { runCli } from '../interface/cli';

const evidence: AdherenceEvidence = {
  tools: [{ name: 'curl', responsibility: 'HTTP validation', verifyCommand: 'curl --version' }],
  storyVerifyAll: { ok: true, unverifiedStories: 0 },
  logCorrectionPatterns: 0,
  contextTier: 2,
  requiredContextTier: 2,
  entropyScore: 0,
  maxEntropyScore: 20,
  proposals: [
    {
      problem: 'Trace friction found repeated manual validation.',
      evidence: 'trace:t1 friction:f1',
      suggested_change: 'Add the missing functional check.',
      confidence: 0.7,
    },
  ],
};

describe('ScoreAdherence', () => {
  it('loads evidence, scores it, and writes adherence.json', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'score-adherence-'));
    const evidencePath = path.join(dir, 'evidence.json');
    const outPath = path.join(dir, 'T1-project-setup', 'adherence.json');
    await writeFile(evidencePath, JSON.stringify(evidence));

    const score = await new ScoreAdherence(
      new JsonAdherenceEvidenceProvider(evidencePath),
      new FsAdherenceArtifactWriter(outPath),
    ).run();

    expect(score).toMatchObject({ adherence_pass: 6, adherence_total: 6 });
    await expect(readFile(outPath, 'utf8')).resolves.toContain('"adherence_pass": 6');
  });

  it('exposes adherence artifact generation through the CLI', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'score-adherence-cli-'));
    const evidencePath = path.join(dir, 'evidence.json');
    const outPath = path.join(dir, 'adherence.json');
    await writeFile(evidencePath, JSON.stringify(evidence));

    let stdout = '';
    const code = await runCli(['adherence', 'score', '--evidence', evidencePath, '--out', outPath], {
      stdout: (message) => {
        stdout += message;
      },
      stderr: () => {},
    });

    expect(code).toBe(0);
    expect(stdout).toContain('Adherence scored: 6/6');
    await expect(readFile(outPath, 'utf8')).resolves.toContain('"adherence_total": 6');
  });
});
