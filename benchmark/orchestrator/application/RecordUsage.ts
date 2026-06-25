import { CostModel, type ModelRate } from '../domain/cost';
import type { Interaction, TaskUsageArtifact } from '../domain/usage';
import type { RawAgentOutput } from '../ports/AgentAdapter';
import type { PricingProvider } from '../ports/PricingProvider';
import type { UsageArtifactWriter } from '../ports/UsageArtifactWriter';
import type { UsageParser } from '../ports/UsageParser';

export interface RecordUsageOptions {
  allowMissingPricing?: boolean;
  pricingVersion?: string;
}

export class RecordUsage {
  constructor(
    private readonly parser: UsageParser,
    private readonly pricing: PricingProvider,
    private readonly writer: UsageArtifactWriter,
    private readonly options: RecordUsageOptions = {},
  ) {}

  async record(raw: RawAgentOutput, taskDir: string): Promise<TaskUsageArtifact> {
    const usage = await this.parser.parse(raw);
    const rates = await this.loadRates(usage.interactions);
    const costModel = new CostModel(rates);

    let totalCost = 0;
    let hasUnknownCost = !usage.usageKnown;
    const interactions = usage.interactions.map((interaction) => {
      if (!rates.has(interaction.model)) {
        hasUnknownCost = true;
        return { ...interaction, costUsd: null };
      }

      const costUsd = costModel.costForInteraction(interaction).costUsd;
      totalCost += costUsd;
      return { ...interaction, costUsd };
    });

    const artifact: TaskUsageArtifact = {
      provider: usage.provider,
      usageKnown: usage.usageKnown,
      interactions,
      totals: {
        ...usage.totals,
        costUsd: hasUnknownCost ? null : Number(totalCost.toFixed(8)),
      },
      pricingVersion: this.options.pricingVersion,
    };

    await this.writer.writeUsage(taskDir, artifact);
    await this.writer.writeTokens(taskDir, {
      input_tokens: artifact.totals.inputTokens + artifact.totals.cachedInputTokens,
      output_tokens: artifact.totals.outputTokens,
      total_tokens: artifact.totals.totalTokens,
      estimated_cost_usd: artifact.totals.costUsd,
    });

    return artifact;
  }

  private async loadRates(interactions: Interaction[]): Promise<Map<string, ModelRate>> {
    const rates = new Map<string, ModelRate>();
    for (const model of new Set(interactions.map((interaction) => interaction.model))) {
      const rate = await this.pricing.rateFor(model);
      if (!rate) {
        if (this.options.allowMissingPricing) {
          continue;
        }

        throw new Error(`missing pricing for model: ${model}`);
      }

      rates.set(model, rate);
    }

    return rates;
  }
}
