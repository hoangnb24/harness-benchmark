import { readFile } from 'node:fs/promises';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { RecordUsage } from '../application/RecordUsage';
import type { ModelRate } from '../domain/cost';
import type { NormalizedUsage, TaskUsageArtifact, TokensCompatibilityArtifact } from '../domain/usage';
import { FsUsageArtifactWriter } from '../infrastructure/FsUsageArtifactWriter';
import type { RawAgentOutput } from '../ports/AgentAdapter';
import type { PricingProvider } from '../ports/PricingProvider';
import type { UsageArtifactWriter } from '../ports/UsageArtifactWriter';
import type { UsageParser } from '../ports/UsageParser';

describe('RecordUsage', () => {
  it('writes priced usage.json and tokens.json compatibility artifacts', async () => {
    const taskDir = await mkdtemp(path.join(tmpdir(), 'record-usage-'));
    const usage = fixtureUsage('gpt-test');
    const artifact = await new RecordUsage(
      new StaticUsageParser(usage),
      new MapPricingProvider([
        {
          model: 'gpt-test',
          provider: 'openai',
          inputUsdPerMillion: 1,
          cachedInputUsdPerMillion: 0.1,
          outputUsdPerMillion: 10,
        },
      ]),
      new FsUsageArtifactWriter(),
      { pricingVersion: 'test' },
    ).record({ exitCode: 0 }, taskDir);

    expect(artifact.totals).toMatchObject({
      inputTokens: 100,
      cachedInputTokens: 50,
      outputTokens: 25,
      totalTokens: 175,
      costUsd: 0.000355,
    });
    await expect(readJson(path.join(taskDir, 'usage.json'))).resolves.toMatchObject({
      provider: 'openai',
      pricingVersion: 'test',
      interactions: [{ model: 'gpt-test', costUsd: 0.000355 }],
    });
    await expect(readJson(path.join(taskDir, 'tokens.json'))).resolves.toEqual({
      input_tokens: 150,
      output_tokens: 25,
      total_tokens: 175,
      estimated_cost_usd: 0.000355,
    });
  });

  it('fails missing pricing unless null cost is explicitly allowed', async () => {
    const parser = new StaticUsageParser(fixtureUsage('missing-model'));
    const writer = new RecordingUsageWriter();

    await expect(
      new RecordUsage(parser, new MapPricingProvider([]), writer).record({ exitCode: 0 }, '/tmp/task'),
    ).rejects.toThrow(/missing pricing for model: missing-model/);

    const artifact = await new RecordUsage(parser, new MapPricingProvider([]), writer, {
      allowMissingPricing: true,
    }).record({ exitCode: 0 }, '/tmp/task');

    expect(artifact.interactions[0].costUsd).toBeNull();
    expect(artifact.totals.costUsd).toBeNull();
    expect(writer.tokens?.estimated_cost_usd).toBeNull();
  });
});

class StaticUsageParser implements UsageParser {
  constructor(private readonly usage: NormalizedUsage) {}

  async parse(_raw: RawAgentOutput): Promise<NormalizedUsage> {
    return this.usage;
  }
}

class MapPricingProvider implements PricingProvider {
  private readonly rates: Map<string, ModelRate>;

  constructor(rates: ModelRate[]) {
    this.rates = new Map(rates.map((rate) => [rate.model, rate]));
  }

  async rateFor(model: string): Promise<ModelRate | undefined> {
    return this.rates.get(model);
  }
}

class RecordingUsageWriter implements UsageArtifactWriter {
  usage?: TaskUsageArtifact;
  tokens?: TokensCompatibilityArtifact;

  async writeUsage(_taskDir: string, artifact: TaskUsageArtifact): Promise<void> {
    this.usage = artifact;
  }

  async writeTokens(_taskDir: string, artifact: TokensCompatibilityArtifact): Promise<void> {
    this.tokens = artifact;
  }
}

function fixtureUsage(model: string): NormalizedUsage {
  return {
    provider: 'openai',
    usageKnown: true,
    interactions: [
      {
        model,
        inputTokens: 100,
        cachedInputTokens: 50,
        outputTokens: 25,
        reasoningTokens: 10,
      },
    ],
    totals: {
      inputTokens: 100,
      cachedInputTokens: 50,
      outputTokens: 25,
      reasoningTokens: 10,
      totalTokens: 175,
    },
  };
}

async function readJson(filePath: string): Promise<unknown> {
  return JSON.parse(await readFile(filePath, 'utf8')) as unknown;
}
