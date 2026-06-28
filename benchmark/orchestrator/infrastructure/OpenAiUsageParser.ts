import { readFile } from 'node:fs/promises';
import { sumUsage, type Interaction, type NormalizedUsage } from '../domain/usage';
import type { RawAgentOutput } from '../ports/AgentAdapter';
import type { UsageParser } from '../ports/UsageParser';

interface OpenAiUsage {
  input_tokens?: number;
  cached_input_tokens?: number;
  output_tokens?: number;
  reasoning_output_tokens?: number;
  prompt_tokens?: number;
  completion_tokens?: number;
  prompt_tokens_details?: { cached_tokens?: number };
  completion_tokens_details?: { reasoning_tokens?: number };
}

interface OpenAiEvent {
  type?: string;
  model?: string;
  usage?: OpenAiUsage;
}

export class OpenAiUsageParser implements UsageParser {
  constructor(private readonly fallbackModel = 'unknown') {}

  async parse(raw: RawAgentOutput): Promise<NormalizedUsage> {
    if (raw.eventsPath) {
      return this.parseJsonl(await readFile(raw.eventsPath, 'utf8'));
    }

    if (raw.stdoutPath) {
      return this.parseJson(await readFile(raw.stdoutPath, 'utf8'));
    }

    return unknownUsage('openai');
  }

  parseJsonl(contents: string): NormalizedUsage {
    const interactions: Interaction[] = [];

    for (const line of contents.split(/\r?\n/)) {
      if (!line.trim()) {
        continue;
      }

      const event = JSON.parse(line) as OpenAiEvent;
      if (event.type !== 'turn.completed' || !event.usage) {
        continue;
      }

      interactions.push(this.interactionFromUsage(event.usage, event.model));
    }

    return {
      provider: 'openai',
      usageKnown: interactions.length > 0,
      interactions,
      totals: sumUsage(interactions),
    };
  }

  parseJson(contents: string): NormalizedUsage {
    const payload = JSON.parse(contents) as OpenAiEvent;
    if (!payload.usage) {
      return unknownUsage('openai');
    }

    const interactions = [this.interactionFromUsage(payload.usage, payload.model)];
    return {
      provider: 'openai',
      usageKnown: true,
      interactions,
      totals: sumUsage(interactions),
    };
  }

  private interactionFromUsage(usage: OpenAiUsage, model?: string): Interaction {
    const totalInput = usage.input_tokens ?? usage.prompt_tokens ?? 0;
    const cachedInput =
      usage.cached_input_tokens ?? usage.prompt_tokens_details?.cached_tokens ?? 0;

    return {
      model: model ?? this.fallbackModel,
      inputTokens: Math.max(totalInput - cachedInput, 0),
      cachedInputTokens: cachedInput,
      outputTokens: usage.output_tokens ?? usage.completion_tokens ?? 0,
      reasoningTokens:
        usage.reasoning_output_tokens ?? usage.completion_tokens_details?.reasoning_tokens ?? 0,
    };
  }
}

function unknownUsage(provider: 'openai'): NormalizedUsage {
  return {
    provider,
    usageKnown: false,
    interactions: [],
    totals: sumUsage([]),
  };
}
