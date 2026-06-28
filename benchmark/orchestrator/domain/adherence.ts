export type AdherenceCheckName =
  | 'tool_registry_hygiene'
  | 'verification_discipline'
  | 'intervention_capture'
  | 'context_compliance'
  | 'entropy_outcome'
  | 'evolution_signal';

export interface AdherenceCheckResult {
  name: AdherenceCheckName;
  pass: boolean;
  expected: string;
  actual: string;
}

export interface ToolReviewRow {
  name: string;
  responsibility?: string;
  verifyCommand?: string;
  broken?: boolean;
}

export interface InterventionReviewRow {
  traceId?: string;
  storyId?: string;
  type?: string;
}

export interface ProposalReviewRow {
  problem?: string;
  evidence?: string;
  suggested_change?: string;
  confidence?: number;
}

export interface AdherenceEvidence {
  tools?: ToolReviewRow[];
  storyVerifyAll?: { ok: boolean; unverifiedStories: number };
  logCorrectionPatterns?: number;
  interventions?: InterventionReviewRow[];
  contextTier?: number;
  requiredContextTier: number;
  entropyScore?: number;
  maxEntropyScore: number;
  proposals?: ProposalReviewRow[];
}

export interface AdherenceScore {
  adherence_pass: number;
  adherence_total: number;
  checks: AdherenceCheckResult[];
}

export function summarizeAdherence(checks: AdherenceCheckResult[]): AdherenceScore {
  return {
    adherence_pass: checks.filter((check) => check.pass).length,
    adherence_total: checks.length,
    checks,
  };
}
