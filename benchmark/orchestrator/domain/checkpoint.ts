export type StepStatus = 'pending' | 'running' | 'passed' | 'failed' | 'skipped';
export type FailureClass = 'retriable' | 'fatal' | null;

export interface CheckpointStep {
  task: string;
  status: StepStatus;
  checkpoint?: string;
  failureClass: FailureClass;
  exitCode?: number;
  detail?: string;
  startedAt?: string;
  endedAt?: string;
}

export interface CheckpointState {
  runId: string;
  agent?: string;
  model?: string;
  harnessRef?: string;
  workspaceDir?: string;
  steps: CheckpointStep[];
}

export interface InitialCheckpointOptions {
  runId: string;
  agent: string;
  model?: string;
  harnessRef: string;
  workspaceDir: string;
  taskIds: string[];
}

export function firstRunnableStep(state: CheckpointState): CheckpointStep | undefined {
  return state.steps.find((step) => step.status !== 'passed' && step.status !== 'skipped');
}

export function createInitialCheckpointState(options: InitialCheckpointOptions): CheckpointState {
  return {
    runId: options.runId,
    agent: options.agent,
    model: options.model,
    harnessRef: options.harnessRef,
    workspaceDir: options.workspaceDir,
    steps: options.taskIds.map((task) => ({ task, status: 'pending', failureClass: null })),
  };
}

export function markStepRunning(
  state: CheckpointState,
  task: string,
  startedAt: string,
): CheckpointState {
  return updateStep(state, task, (step) => ({
    ...step,
    status: 'running',
    failureClass: null,
    startedAt,
    endedAt: undefined,
    exitCode: undefined,
    detail: undefined,
  }));
}

export function markStepPassed(
  state: CheckpointState,
  task: string,
  checkpoint: string,
  endedAt: string,
): CheckpointState {
  return updateStep(state, task, (step) => ({
    ...step,
    status: 'passed',
    checkpoint,
    failureClass: null,
    endedAt,
    exitCode: undefined,
    detail: undefined,
  }));
}

export function markStepFailed(
  state: CheckpointState,
  task: string,
  failureClass: Exclude<FailureClass, null>,
  exitCode: number,
  detail: string,
  endedAt: string,
): CheckpointState {
  return updateStep(state, task, (step) => ({
    ...step,
    status: 'failed',
    failureClass,
    exitCode,
    detail,
    endedAt,
  }));
}

export function classifyFailure(exitCode: number, stderr: string): Exclude<FailureClass, null> {
  if (exitCode === 124) {
    return 'retriable';
  }

  const retriablePatterns = [
    /rate[_ -]?limit/i,
    /insufficient[_ -]?quota/i,
    /out of credits/i,
    /network/i,
    /timeout/i,
    /temporarily unavailable/i,
    /ECONNRESET/i,
    /ETIMEDOUT/i,
  ];

  return retriablePatterns.some((pattern) => pattern.test(stderr)) ? 'retriable' : 'fatal';
}

function updateStep(
  state: CheckpointState,
  task: string,
  update: (step: CheckpointStep) => CheckpointStep,
): CheckpointState {
  let found = false;
  const steps = state.steps.map((step) => {
    if (step.task !== task) {
      return step;
    }

    found = true;
    return update(step);
  });

  if (!found) {
    throw new Error(`unknown checkpoint step: ${task}`);
  }

  return { ...state, steps };
}
