import { RunBenchmark } from '../application/RunBenchmark';
import { LegacyCodexAdapter, type CommandRunner } from '../infrastructure/LegacyCodexAdapter';
import type { FunctionalProbe } from '../ports/FunctionalProbe';

export interface RunnerConfig {
  agent: 'codex';
  commandRunner: CommandRunner;
  functional: FunctionalProbe;
}

export function buildRunner(config: RunnerConfig): RunBenchmark {
  const agents = {
    codex: () => new LegacyCodexAdapter(config.commandRunner),
  };

  return new RunBenchmark({
    agent: agents[config.agent](),
    functional: config.functional,
  });
}
