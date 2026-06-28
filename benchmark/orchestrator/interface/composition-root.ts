import { RunBenchmark } from '../application/RunBenchmark';
import {
  ClaudeCodeAdapter,
  CustomAgentAdapter,
  LegacyCodexAdapter,
  type CommandRunner,
} from '../infrastructure/LegacyCodexAdapter';
import { RecordUsage } from '../application/RecordUsage';
import { AnthropicUsageParser } from '../infrastructure/AnthropicUsageParser';
import { CustomUsageParser } from '../infrastructure/CustomUsageParser';
import { FsUsageArtifactWriter } from '../infrastructure/FsUsageArtifactWriter';
import { FsWorkspaceSnapshotStore } from '../infrastructure/FsWorkspaceSnapshotStore';
import { JsonPricingProvider } from '../infrastructure/JsonPricingProvider';
import { LegacyTaskArtifactRecorder } from '../infrastructure/LegacyTaskArtifactRecorder';
import { OpenAiUsageParser } from '../infrastructure/OpenAiUsageParser';
import type { FunctionalProbe } from '../ports/FunctionalProbe';
import type { CheckpointStore } from '../ports/CheckpointStore';
import type { UsageParser } from '../ports/UsageParser';

export type RunnerAgent = 'codex' | 'claude' | 'custom';

export interface RunnerConfig {
  agent: RunnerAgent;
  commandRunner: CommandRunner;
  customCommand?: string;
  customArgs?: string[];
  functional: FunctionalProbe;
  model?: string;
  timeoutSeconds?: number;
  pricingPath?: string;
  pricingVersion?: string;
  recordUsage?: boolean;
  recordScoringArtifacts?: boolean;
  allowMissingPricing?: boolean;
  snapshotWorkspaces?: boolean;
  checkpoints?: CheckpointStore;
}

export function buildRunner(config: RunnerConfig): RunBenchmark {
  const agents = {
    codex: () => new LegacyCodexAdapter(config.commandRunner),
    claude: () => new ClaudeCodeAdapter(config.commandRunner),
    custom: () =>
      new CustomAgentAdapter(
        config.commandRunner,
        config.customCommand ?? fail('customCommand is required for custom agent runs'),
        config.customArgs ?? [],
      ),
  };

  return new RunBenchmark({
    agent: agents[config.agent](),
    functional: config.functional,
    checkpoints: config.checkpoints,
    usage: config.recordUsage ? buildUsageRecorder(config) : undefined,
    snapshots: config.snapshotWorkspaces ? new FsWorkspaceSnapshotStore() : undefined,
    artifacts: config.recordScoringArtifacts
      ? new LegacyTaskArtifactRecorder(config.commandRunner)
      : undefined,
  });
}

function fail(message: string): never {
  throw new Error(message);
}

function buildUsageRecorder(config: RunnerConfig): RecordUsage {
  return new RecordUsage(
    usageParserFor(config.agent, config.model),
    new JsonPricingProvider(config.pricingPath ?? 'benchmark/pricing/models.json'),
    new FsUsageArtifactWriter(),
    {
      allowMissingPricing: config.allowMissingPricing,
      pricingVersion: config.pricingVersion,
    },
  );
}

function usageParserFor(agent: RunnerAgent, model?: string): UsageParser {
  if (agent === 'codex') {
    return new OpenAiUsageParser(model);
  }

  if (agent === 'claude') {
    return new AnthropicUsageParser(model);
  }

  return new CustomUsageParser();
}
