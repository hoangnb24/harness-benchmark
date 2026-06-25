import { readFile } from 'node:fs/promises';
import type { ModelRate } from '../domain/cost';
import type { PricingProvider } from '../ports/PricingProvider';

interface PricingTableFile {
  version: string;
  models: Record<
    string,
    {
      provider: string;
      input: number;
      cachedInput: number;
      output: number;
      reasoning?: number;
      source: string;
      updatedAt: string;
    }
  >;
}

export class JsonPricingProvider implements PricingProvider {
  private table?: Map<string, ModelRate>;

  constructor(private readonly pricingPath: string) {}

  async rateFor(model: string): Promise<ModelRate | undefined> {
    return (await this.load()).get(model);
  }

  async requireRate(model: string): Promise<ModelRate> {
    const rate = await this.rateFor(model);
    if (!rate) {
      throw new Error(`missing pricing for model: ${model}`);
    }

    return rate;
  }

  async allRates(): Promise<ModelRate[]> {
    return [...(await this.load()).values()];
  }

  private async load(): Promise<Map<string, ModelRate>> {
    if (this.table) {
      return this.table;
    }

    const parsed = JSON.parse(await readFile(this.pricingPath, 'utf8')) as PricingTableFile;
    this.table = new Map(
      Object.entries(parsed.models).map(([model, rate]) => [
        model,
        {
          model,
          provider: rate.provider,
          inputUsdPerMillion: rate.input,
          cachedInputUsdPerMillion: rate.cachedInput,
          outputUsdPerMillion: rate.output,
          reasoningUsdPerMillion: rate.reasoning,
        },
      ]),
    );

    return this.table;
  }
}
