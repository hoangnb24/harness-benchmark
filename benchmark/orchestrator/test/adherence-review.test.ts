import { describe, expect, it } from 'vitest';
import { ReviewAdherence } from '../application/ReviewAdherence';
import type { AdherenceEvidence } from '../domain/adherence';

const followedHarnessEvidence = (): AdherenceEvidence => ({
  tools: [{ name: 'curl', responsibility: 'HTTP validation', verifyCommand: 'curl --version' }],
  storyVerifyAll: { ok: true, unverifiedStories: 0 },
  logCorrectionPatterns: 1,
  interventions: [{ traceId: 'trace-7', type: 'retry' }],
  contextTier: 2,
  requiredContextTier: 2,
  entropyScore: 5,
  maxEntropyScore: 20,
  proposals: [
    {
      problem: 'Functional checks missed sharing revocation.',
      evidence: 'trace:trace-7 friction:f-1',
      suggested_change: 'Add a revocation check to T10.',
      confidence: 0.8,
    },
  ],
});

describe('ReviewAdherence', () => {
  it('passes followed-harness evidence', () => {
    const score = new ReviewAdherence().review(followedHarnessEvidence());

    expect(score).toMatchObject({ adherence_pass: 6, adherence_total: 6 });
    expect(score.checks.every((check) => check.pass)).toBe(true);
  });

  it('fails ignored-harness evidence deterministically', () => {
    const score = new ReviewAdherence().review({
      requiredContextTier: 2,
      maxEntropyScore: 20,
      tools: [],
      storyVerifyAll: { ok: false, unverifiedStories: 2 },
      logCorrectionPatterns: 1,
      interventions: [],
      entropyScore: 80,
      proposals: [],
    });

    expect(score.adherence_pass).toBe(1);
    expect(score.checks.find((check) => check.name === 'verification_discipline')).toMatchObject({
      pass: false,
      actual: 'ok=false, unverified=2',
    });
    expect(score.checks.find((check) => check.name === 'intervention_capture')).toMatchObject({
      pass: false,
    });
    expect(score.checks.find((check) => check.name === 'context_compliance')).toMatchObject({
      pass: false,
      actual: 'missing context score',
    });
  });

  it('fails broken or incomplete tool rows', () => {
    const evidence = followedHarnessEvidence();
    evidence.tools = [
      { name: 'curl', responsibility: 'HTTP validation', verifyCommand: 'curl --version' },
      { name: 'broken-tool', broken: true },
    ];

    const toolCheck = new ReviewAdherence()
      .review(evidence)
      .checks.find((check) => check.name === 'tool_registry_hygiene');

    expect(toolCheck).toMatchObject({ pass: false, actual: '1 broken, 1 incomplete' });
  });

  it('fails proposals that do not cite current-run evidence', () => {
    const evidence = followedHarnessEvidence();
    evidence.proposals = [
      {
        problem: 'Something is vague.',
        evidence: 'no durable id here',
        suggested_change: 'Improve something.',
        confidence: 0.9,
      },
    ];

    const proposalCheck = new ReviewAdherence()
      .review(evidence)
      .checks.find((check) => check.name === 'evolution_signal');

    expect(proposalCheck).toMatchObject({
      pass: false,
      actual: '0/1 well-formed proposals',
    });
  });
});
