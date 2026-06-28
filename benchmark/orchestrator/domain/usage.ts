export type UsageProvider = 'openai' | 'anthropic' | 'custom';

export interface Interaction {
  model: string;
  inputTokens: number; // fresh, non-cached input tokens
  cachedInputTokens: number;
  outputTokens: number;
  reasoningTokens?: number;
  reasoningTokensBilledSeparately?: boolean;
}

export interface UsageTotals {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  totalTokens: number;
}

export interface NormalizedUsage {
  provider: UsageProvider;
  usageKnown: boolean;
  interactions: Interaction[];
  totals: UsageTotals;
}

export interface TaskUsageInteraction extends Interaction {
  costUsd: number | null;
}

export interface TaskUsageArtifact {
  provider: UsageProvider;
  usageKnown: boolean;
  interactions: TaskUsageInteraction[];
  totals: UsageTotals & { costUsd: number | null };
  pricingVersion?: string;
}

export interface TokensCompatibilityArtifact {
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  estimated_cost_usd: number | null;
}

export function sumUsage(interactions: Interaction[]): UsageTotals {
  const totals = interactions.reduce(
    (acc, interaction) => {
      acc.inputTokens += interaction.inputTokens;
      acc.cachedInputTokens += interaction.cachedInputTokens;
      acc.outputTokens += interaction.outputTokens;
      acc.reasoningTokens += interaction.reasoningTokens ?? 0;
      return acc;
    },
    {
      inputTokens: 0,
      cachedInputTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      totalTokens: 0,
    },
  );

  totals.totalTokens = totals.inputTokens + totals.cachedInputTokens + totals.outputTokens;
  return totals;
}
