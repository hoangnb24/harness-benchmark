import { readFile } from 'node:fs/promises';
import path from 'node:path';
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

  constructor(
    private readonly pricingPath: string,
    private readonly localPricingPath = path.join(path.dirname(pricingPath), 'models.local.json'),
  ) {}

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

    const parsed = await readPricingTable(this.pricingPath);
    const local = await readOptionalPricingTable(this.localPricingPath);
    const models = { ...parsed.models, ...(local?.models ?? {}) };
    this.table = new Map(
      Object.entries(models).map(([model, rate]) => [
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

async function readOptionalPricingTable(filePath: string): Promise<PricingTableFile | undefined> {
  try {
    return await readPricingTable(filePath);
  } catch (error) {
    if (isNotFound(error)) {
      return undefined;
    }

    throw error;
  }
}

async function readPricingTable(filePath: string): Promise<PricingTableFile> {
  try {
    return JSON.parse(await readFile(filePath, 'utf8')) as PricingTableFile;
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`invalid pricing JSON in ${filePath}: ${error.message}`);
    }

    throw error;
  }
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === 'ENOENT'
  );
}
