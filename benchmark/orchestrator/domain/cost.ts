import type { Interaction } from './usage';

export interface ModelRate {
  model: string;
  provider: string;
  inputUsdPerMillion: number;
  cachedInputUsdPerMillion: number;
  outputUsdPerMillion: number;
  reasoningUsdPerMillion?: number;
}

export interface InteractionCost {
  model: string;
  costUsd: number;
}

export class CostModel {
  constructor(private readonly rates: ReadonlyMap<string, ModelRate>) {}

  costForInteraction(interaction: Interaction): InteractionCost {
    const rate = this.rates.get(interaction.model);
    if (!rate) {
      throw new Error(`missing pricing for model: ${interaction.model}`);
    }

    const reasoningOutsideOutput =
      interaction.reasoningTokensBilledSeparately === true ? interaction.reasoningTokens ?? 0 : 0;

    const costUsd =
      (interaction.inputTokens / 1_000_000) * rate.inputUsdPerMillion +
      (interaction.cachedInputTokens / 1_000_000) * rate.cachedInputUsdPerMillion +
      (interaction.outputTokens / 1_000_000) * rate.outputUsdPerMillion +
      (reasoningOutsideOutput / 1_000_000) *
        (rate.reasoningUsdPerMillion ?? rate.outputUsdPerMillion);

    return {
      model: interaction.model,
      costUsd: Number(costUsd.toFixed(8)),
    };
  }
}
