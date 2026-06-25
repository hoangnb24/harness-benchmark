import { RunBenchmark } from '../application/RunBenchmark';
import {
  ClaudeCodeAdapter,
  CustomAgentAdapter,
  LegacyCodexAdapter,
  type CommandRunner,
} from '../infrastructure/LegacyCodexAdapter';
import type { FunctionalProbe } from '../ports/FunctionalProbe';

export type RunnerAgent = 'codex' | 'claude' | 'custom';

export interface RunnerConfig {
  agent: RunnerAgent;
  commandRunner: CommandRunner;
  customCommand?: string;
  customArgs?: string[];
  functional: FunctionalProbe;
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
  });
}

function fail(message: string): never {
  throw new Error(message);
}
