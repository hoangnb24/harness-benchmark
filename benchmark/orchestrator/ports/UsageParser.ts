import type { NormalizedUsage } from '../domain/usage';
import type { RawAgentOutput } from './AgentAdapter';

export interface UsageParser {
  parse(raw: RawAgentOutput): Promise<NormalizedUsage>;
}
