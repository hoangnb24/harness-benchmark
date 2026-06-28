import type { TaskDefinition } from '../domain/task';

export interface CheckResult {
  name: string;
  pass: boolean;
  expected?: string | number;
  actual?: string | number;
  diagnostic?: 'server_startup';
}

export interface FunctionalProbe {
  run(task: TaskDefinition, projectDir: string): Promise<CheckResult[]>;
}
