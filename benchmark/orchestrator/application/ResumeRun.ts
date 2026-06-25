import type { CheckpointState, CheckpointStep } from '../domain/checkpoint';

export type ResumeMode =
  | { kind: 'resume' }
  | { kind: 'only'; task: string; force?: boolean }
  | { kind: 'from'; task: string }
  | { kind: 'steps'; tasks: string[]; force?: boolean }
  | { kind: 'retry-failed' };

export interface ResumePlanStep {
  task: string;
  status: CheckpointStep['status'];
  failureClass: CheckpointStep['failureClass'];
  restoreCheckpoint?: string;
}

export interface ResumePlan {
  runId: string;
  steps: ResumePlanStep[];
}

export class ResumeRun {
  plan(state: CheckpointState, mode: ResumeMode): ResumePlan {
    const selected = this.selectSteps(state, mode);

    return {
      runId: state.runId,
      steps: selected.map((step) => ({
        task: step.task,
        status: step.status,
        failureClass: step.failureClass,
        restoreCheckpoint: checkpointBefore(state.steps, step.task),
      })),
    };
  }

  private selectSteps(state: CheckpointState, mode: ResumeMode): CheckpointStep[] {
    switch (mode.kind) {
      case 'resume':
        return fromFirstRunnable(state.steps);
      case 'only':
        return filterAlreadyPassed([findStep(state.steps, mode.task)], Boolean(mode.force));
      case 'from':
        return stepsFrom(state.steps, mode.task);
      case 'steps':
        return filterAlreadyPassed(
          mode.tasks.map((task) => findStep(state.steps, task)),
          Boolean(mode.force),
        );
      case 'retry-failed':
        return state.steps.filter(
          (step) => step.status === 'failed' && step.failureClass === 'retriable',
        );
    }
  }
}

function fromFirstRunnable(steps: CheckpointStep[]): CheckpointStep[] {
  const index = steps.findIndex((step) => step.status !== 'passed' && step.status !== 'skipped');
  if (index === -1) {
    return [];
  }

  return steps.slice(index).filter((step) => step.status !== 'passed' && step.status !== 'skipped');
}

function stepsFrom(steps: CheckpointStep[], task: string): CheckpointStep[] {
  const index = steps.findIndex((step) => step.task === task);
  if (index === -1) {
    throw new Error(`unknown checkpoint step: ${task}`);
  }

  return steps.slice(index);
}

function findStep(steps: CheckpointStep[], task: string): CheckpointStep {
  const step = steps.find((candidate) => candidate.task === task);
  if (!step) {
    throw new Error(`unknown checkpoint step: ${task}`);
  }

  return step;
}

function filterAlreadyPassed(steps: CheckpointStep[], force: boolean): CheckpointStep[] {
  if (force) {
    return steps;
  }

  return steps.filter((step) => step.status !== 'passed');
}

function checkpointBefore(steps: CheckpointStep[], task: string): string | undefined {
  const index = steps.findIndex((step) => step.task === task);
  if (index === 0) {
    return 'checkpoints/pre-run';
  }

  if (index < 0) {
    return undefined;
  }

  return steps[index - 1].checkpoint;
}
