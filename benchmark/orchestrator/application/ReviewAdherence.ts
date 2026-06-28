import {
  summarizeAdherence,
  type AdherenceCheckResult,
  type AdherenceEvidence,
  type AdherenceScore,
  type InterventionReviewRow,
  type ProposalReviewRow,
  type ToolReviewRow,
} from '../domain/adherence';

const allowedInterventionTypes = new Set([
  'correction',
  'retry',
  'tool_failure',
  'provider_failure',
  'scope_change',
  'validation_failure',
]);

export class ReviewAdherence {
  review(evidence: AdherenceEvidence): AdherenceScore {
    const checks: AdherenceCheckResult[] = [
      this.reviewToolRegistry(evidence.tools ?? []),
      this.reviewVerification(evidence.storyVerifyAll),
      this.reviewInterventions(evidence.logCorrectionPatterns ?? 0, evidence.interventions ?? []),
      this.reviewContext(evidence.contextTier, evidence.requiredContextTier),
      this.reviewEntropy(evidence.entropyScore, evidence.maxEntropyScore),
      this.reviewEvolution(evidence.proposals ?? []),
    ];

    return summarizeAdherence(checks);
  }

  private reviewToolRegistry(tools: ToolReviewRow[]): AdherenceCheckResult {
    const broken = tools.filter((tool) => tool.broken);
    const incomplete = tools.filter(
      (tool) => !tool.name || !tool.responsibility || !tool.verifyCommand,
    );
    const pass = broken.length === 0 && incomplete.length === 0;

    return {
      name: 'tool_registry_hygiene',
      pass,
      expected: 'valid tool rows with responsibility and verify command; no broken tools',
      actual: pass ? `${tools.length} valid tools` : `${broken.length} broken, ${incomplete.length} incomplete`,
    };
  }

  private reviewVerification(
    verifyAll: AdherenceEvidence['storyVerifyAll'],
  ): AdherenceCheckResult {
    const pass = verifyAll?.ok === true && verifyAll.unverifiedStories === 0;
    return {
      name: 'verification_discipline',
      pass,
      expected: 'story verify-all ok with zero unverified stories',
      actual: verifyAll
        ? `ok=${verifyAll.ok}, unverified=${verifyAll.unverifiedStories}`
        : 'missing verify-all result',
    };
  }

  private reviewInterventions(
    logCorrectionPatterns: number,
    interventions: InterventionReviewRow[],
  ): AdherenceCheckResult {
    const linked = interventions.filter(
      (row) =>
        (row.traceId || row.storyId) && row.type && allowedInterventionTypes.has(row.type),
    );
    const pass = logCorrectionPatterns === 0 || linked.length > 0;

    return {
      name: 'intervention_capture',
      pass,
      expected: 'no correction patterns, or at least one linked intervention with allowed type',
      actual: `${logCorrectionPatterns} correction patterns, ${linked.length} linked interventions`,
    };
  }

  private reviewContext(contextTier: number | undefined, requiredTier: number): AdherenceCheckResult {
    const pass = typeof contextTier === 'number' && contextTier >= requiredTier;
    return {
      name: 'context_compliance',
      pass,
      expected: `context tier >= ${requiredTier}`,
      actual: contextTier === undefined ? 'missing context score' : `context tier ${contextTier}`,
    };
  }

  private reviewEntropy(
    entropyScore: number | undefined,
    maxEntropyScore: number,
  ): AdherenceCheckResult {
    const pass = typeof entropyScore === 'number' && entropyScore <= maxEntropyScore;
    return {
      name: 'entropy_outcome',
      pass,
      expected: `entropy <= ${maxEntropyScore}`,
      actual: entropyScore === undefined ? 'missing entropy score' : `entropy ${entropyScore}`,
    };
  }

  private reviewEvolution(proposals: ProposalReviewRow[]): AdherenceCheckResult {
    const wellFormed = proposals.filter(isWellFormedProposal);
    return {
      name: 'evolution_signal',
      pass: wellFormed.length > 0,
      expected:
        'at least one proposal with problem, evidence, suggested_change, confidence, and current-run evidence id',
      actual: `${wellFormed.length}/${proposals.length} well-formed proposals`,
    };
  }
}

function isWellFormedProposal(proposal: ProposalReviewRow): boolean {
  return (
    nonEmpty(proposal.problem) &&
    nonEmpty(proposal.evidence) &&
    nonEmpty(proposal.suggested_change) &&
    typeof proposal.confidence === 'number' &&
    proposal.confidence >= 0 &&
    proposal.confidence <= 1 &&
    /\b(trace|story|intervention|friction)[:#-]?[A-Za-z0-9_-]+/i.test(proposal.evidence)
  );
}

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}
