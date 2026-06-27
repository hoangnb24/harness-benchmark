import type { TaskDefinition } from '../domain/task';

export interface AgentInvocationContext {
  runId: string;
  projectDir: string;
  artifactsDir: string;
  model?: string;
  timeoutSeconds?: number;
}

export interface RawAgentOutput {
  exitCode: number;
  stderr?: string;
  stdoutPath?: string;
  stderrPath?: string;
  eventsPath?: string;
}

export interface AgentAdapter {
  invoke(task: TaskDefinition, context: AgentInvocationContext): Promise<RawAgentOutput>;
}
