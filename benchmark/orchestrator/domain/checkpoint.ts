export type StepStatus = 'pending' | 'running' | 'passed' | 'failed' | 'skipped';
export type FailureClass = 'retriable' | 'fatal' | null;

export interface CheckpointStep {
  task: string;
  status: StepStatus;
  checkpoint?: string;
  failureClass: FailureClass;
  exitCode?: number;
  detail?: string;
}

export interface CheckpointState {
  runId: string;
  steps: CheckpointStep[];
}

export function firstRunnableStep(state: CheckpointState): CheckpointStep | undefined {
  return state.steps.find((step) => step.status !== 'passed' && step.status !== 'skipped');
}
