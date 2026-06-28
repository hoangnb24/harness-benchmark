import { readFile } from 'node:fs/promises';
import { sumUsage, type Interaction, type NormalizedUsage } from '../domain/usage';
import type { RawAgentOutput } from '../ports/AgentAdapter';
import type { UsageParser } from '../ports/UsageParser';

interface CustomUsageFile {
  provider?: 'custom';
  model?: string;
  interactions?: Interaction[];
}

export class CustomUsageParser implements UsageParser {
  async parse(raw: RawAgentOutput): Promise<NormalizedUsage> {
    const usagePath = raw.stdoutPath;
    if (!usagePath) {
      return unknownUsage();
    }

    try {
      const payload = JSON.parse(await readFile(usagePath, 'utf8')) as CustomUsageFile;
      const interactions = payload.interactions ?? [];
      return {
        provider: 'custom',
        usageKnown: interactions.length > 0,
        interactions,
        totals: sumUsage(interactions),
      };
    } catch {
      return unknownUsage();
    }
  }
}

function unknownUsage(): NormalizedUsage {
  return {
    provider: 'custom',
    usageKnown: false,
    interactions: [],
    totals: sumUsage([]),
  };
}
