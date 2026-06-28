import { readFile } from 'node:fs/promises';
import { sumUsage, type Interaction, type NormalizedUsage } from '../domain/usage';
import type { RawAgentOutput } from '../ports/AgentAdapter';
import type { UsageParser } from '../ports/UsageParser';

interface AnthropicUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

interface AnthropicPayload {
  model?: string;
  usage?: AnthropicUsage;
  result?: {
    model?: string;
    usage?: AnthropicUsage;
  };
}

export class AnthropicUsageParser implements UsageParser {
  constructor(private readonly fallbackModel = 'unknown') {}

  async parse(raw: RawAgentOutput): Promise<NormalizedUsage> {
    if (!raw.stdoutPath) {
      return unknownUsage();
    }

    return this.parseJson(await readFile(raw.stdoutPath, 'utf8'));
  }

  parseJson(contents: string): NormalizedUsage {
    const payload = JSON.parse(contents) as AnthropicPayload;
    const usage = payload.result?.usage ?? payload.usage;
    if (!usage) {
      return unknownUsage();
    }

    const interaction: Interaction = {
      model: payload.result?.model ?? payload.model ?? this.fallbackModel,
      inputTokens: (usage.input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0),
      cachedInputTokens: usage.cache_read_input_tokens ?? 0,
      outputTokens: usage.output_tokens ?? 0,
    };

    return {
      provider: 'anthropic',
      usageKnown: true,
      interactions: [interaction],
      totals: sumUsage([interaction]),
    };
  }
}

function unknownUsage(): NormalizedUsage {
  return {
    provider: 'anthropic',
    usageKnown: false,
    interactions: [],
    totals: sumUsage([]),
  };
}
