import type { TaskDefinition } from '../domain/task';
import type { CheckResult } from './FunctionalProbe';

export interface BeforeTaskArtifactsInput {
  task: TaskDefinition;
  artifactsDir: string;
  projectDir: string;
}

export interface AfterTaskArtifactsInput extends BeforeTaskArtifactsInput {
  startedAt: Date;
  endedAt: Date;
  exitCode: number;
  functionalChecks: CheckResult[];
}

export interface TaskArtifactRecorder {
  beforeTask(input: BeforeTaskArtifactsInput): Promise<void>;
  afterTask(input: AfterTaskArtifactsInput): Promise<void>;
}
