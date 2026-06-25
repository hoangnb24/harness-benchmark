import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { AnthropicUsageParser } from '../infrastructure/AnthropicUsageParser';
import { CustomUsageParser } from '../infrastructure/CustomUsageParser';
import { JsonPricingProvider } from '../infrastructure/JsonPricingProvider';
import { OpenAiUsageParser } from '../infrastructure/OpenAiUsageParser';

describe('OpenAiUsageParser', () => {
  it('parses Codex JSONL as one interaction per completed turn', () => {
    const parser = new OpenAiUsageParser('gpt-test');
    const usage = parser.parseJsonl(
      [
        JSON.stringify({ type: 'turn.started' }),
        JSON.stringify({
          type: 'turn.completed',
          usage: {
            input_tokens: 100,
            cached_input_tokens: 40,
            output_tokens: 25,
            reasoning_output_tokens: 5,
          },
        }),
        JSON.stringify({
          type: 'turn.completed',
          model: 'gpt-other',
          usage: {
            input_tokens: 10,
            cached_input_tokens: 0,
            output_tokens: 3,
          },
        }),
      ].join('\n'),
    );

    expect(usage.usageKnown).toBe(true);
    expect(usage.interactions).toHaveLength(2);
    expect(usage.interactions[0]).toMatchObject({
      model: 'gpt-test',
      inputTokens: 60,
      cachedInputTokens: 40,
      outputTokens: 25,
      reasoningTokens: 5,
    });
    expect(usage.totals).toMatchObject({
      inputTokens: 70,
      cachedInputTokens: 40,
      outputTokens: 28,
      totalTokens: 138,
    });
  });

  it('parses Responses-style usage payloads', () => {
    const parser = new OpenAiUsageParser();
    const usage = parser.parseJson(
      JSON.stringify({
        model: 'gpt-response',
        usage: {
          prompt_tokens: 20,
          completion_tokens: 7,
          prompt_tokens_details: { cached_tokens: 5 },
          completion_tokens_details: { reasoning_tokens: 2 },
        },
      }),
    );

    expect(usage.interactions[0]).toMatchObject({
      model: 'gpt-response',
      inputTokens: 15,
      cachedInputTokens: 5,
      outputTokens: 7,
      reasoningTokens: 2,
    });
  });
});

describe('AnthropicUsageParser', () => {
  it('maps cache read tokens to cached input tokens', () => {
    const parser = new AnthropicUsageParser();
    const usage = parser.parseJson(
      JSON.stringify({
        result: {
          model: 'claude-sonnet-4-6',
          usage: {
            input_tokens: 100,
            cache_creation_input_tokens: 20,
            cache_read_input_tokens: 300,
            output_tokens: 40,
          },
        },
      }),
    );

    expect(usage).toMatchObject({
      provider: 'anthropic',
      usageKnown: true,
      totals: {
        inputTokens: 120,
        cachedInputTokens: 300,
        outputTokens: 40,
        totalTokens: 460,
      },
    });
  });
});

describe('CustomUsageParser', () => {
  it('reports unknown usage as null-cost compatible data instead of false zero usage', async () => {
    const parser = new CustomUsageParser();
    const usage = await parser.parse({ exitCode: 0 });

    expect(usage).toMatchObject({
      provider: 'custom',
      usageKnown: false,
      interactions: [],
      totals: {
        inputTokens: 0,
        cachedInputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
      },
    });
  });
});

describe('JsonPricingProvider', () => {
  it('loads rates from a committed-style pricing table and fails missing models explicitly', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'pricing-'));
    const pricingPath = path.join(dir, 'models.json');
    await writeFile(
      pricingPath,
      JSON.stringify({
        version: 'test',
        models: {
          'gpt-test': {
            provider: 'openai',
            input: 1,
            cachedInput: 0.1,
            output: 10,
            source: 'fixture',
            updatedAt: '2026-06-25',
          },
        },
      }),
    );

    const provider = new JsonPricingProvider(pricingPath);
    await expect(provider.rateFor('gpt-test')).resolves.toMatchObject({
      inputUsdPerMillion: 1,
      cachedInputUsdPerMillion: 0.1,
      outputUsdPerMillion: 10,
    });
    await expect(provider.requireRate('missing-model')).rejects.toThrow(/missing-model/);
  });

  it('merges sibling models.local.json overrides into the effective pricing table', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'pricing-local-'));
    await writeFile(
      path.join(dir, 'models.json'),
      JSON.stringify({
        version: 'base',
        models: {
          'gpt-test': {
            provider: 'openai',
            input: 1,
            cachedInput: 0.1,
            output: 10,
            source: 'base',
            updatedAt: '2026-06-25',
          },
        },
      }),
    );
    await writeFile(
      path.join(dir, 'models.local.json'),
      JSON.stringify({
        version: 'local',
        models: {
          'gpt-test': {
            provider: 'openai',
            input: 2,
            cachedInput: 0.2,
            output: 20,
            source: 'local',
            updatedAt: '2026-06-25',
          },
          'local-only': {
            provider: 'custom',
            input: 3,
            cachedInput: 0.3,
            output: 30,
            source: 'local',
            updatedAt: '2026-06-25',
          },
        },
      }),
    );

    const provider = new JsonPricingProvider(path.join(dir, 'models.json'));

    await expect(provider.rateFor('gpt-test')).resolves.toMatchObject({
      inputUsdPerMillion: 2,
      cachedInputUsdPerMillion: 0.2,
      outputUsdPerMillion: 20,
    });
    await expect(provider.rateFor('local-only')).resolves.toMatchObject({
      provider: 'custom',
      inputUsdPerMillion: 3,
    });
  });
});
