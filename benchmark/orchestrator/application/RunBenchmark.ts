import path from 'node:path';
import { validateRunPlan, type RunPlan, type TaskResult } from '../domain/task';
import {
  classifyFailure,
  markStepFailed,
  markStepPassed,
  markStepRunning,
  type CheckpointState,
} from '../domain/checkpoint';
import type { AgentAdapter, AgentInvocationContext, RawAgentOutput } from '../ports/AgentAdapter';
import type { CheckpointStore } from '../ports/CheckpointStore';
import type { Clock } from '../ports/Clock';
import type { FunctionalProbe } from '../ports/FunctionalProbe';
import type { WorkspaceSnapshotStore } from '../ports/WorkspaceSnapshotStore';

export interface RunBenchmarkDeps {
  agent: AgentAdapter;
  functional: FunctionalProbe;
  checkpoints?: CheckpointStore;
  clock?: Clock;
  usage?: UsageRecorder;
  snapshots?: WorkspaceSnapshotStore;
}

export interface UsageRecorder {
  record(raw: RawAgentOutput, taskDir: string): Promise<unknown>;
}

export interface RunBenchmarkContext {
  projectDir: string;
  runDir: string;
  model?: string;
  checkpointState?: CheckpointState;
  restoreCheckpoints?: Record<string, string>;
}

export interface RunBenchmarkResult {
  runId: string;
  tasks: TaskResult[];
}

export class RunBenchmark {
  constructor(private readonly deps: RunBenchmarkDeps) {}

  async run(plan: RunPlan, context: RunBenchmarkContext): Promise<RunBenchmarkResult> {
    validateRunPlan(plan);

    const tasks: TaskResult[] = [];
    let checkpointState =
      context.checkpointState ??
      ({
        runId: plan.runId,
        model: context.model,
        workspaceDir: context.projectDir,
        steps: plan.tasks.map((task) => ({ task: task.id, status: 'pending', failureClass: null })),
      } satisfies CheckpointState);

    if (shouldSavePreRunSnapshot(context.checkpointState, context.restoreCheckpoints)) {
      await this.deps.snapshots?.save({
        runId: plan.runId,
        workspaceDir: context.projectDir,
        checkpointDir: checkpointDir(context.runDir, 'pre-run'),
      });
    }

    for (const task of plan.tasks) {
      const restoreCheckpoint = context.restoreCheckpoints?.[task.id];
      if (restoreCheckpoint) {
        await this.deps.snapshots?.restore({
          runId: plan.runId,
          workspaceDir: context.projectDir,
          checkpointDir: path.join(context.runDir, restoreCheckpoint),
        });
      }

      const artifactsDir = `${context.runDir}/${task.id}`;
      const invocationContext: AgentInvocationContext = {
        runId: plan.runId,
        projectDir: context.projectDir,
        artifactsDir,
        model: context.model,
      };

      checkpointState = markStepRunning(checkpointState, task.id, this.timestamp());
      await this.deps.checkpoints?.save(checkpointState);

      const raw = await this.deps.agent.invoke(task, invocationContext);
      await this.deps.usage?.record(raw, artifactsDir);
      const checks = await this.deps.functional.run(task, context.projectDir);
      const checksPassed = checks.every((check) => check.pass);
      const taskPassed = raw.exitCode === 0 && checksPassed;

      if (taskPassed) {
        await this.deps.snapshots?.save({
          runId: plan.runId,
          workspaceDir: context.projectDir,
          checkpointDir: checkpointDir(context.runDir, task.id),
        });
        checkpointState = markStepPassed(
          checkpointState,
          task.id,
          `checkpoints/${task.id}`,
          this.timestamp(),
        );
      } else if (raw.exitCode !== 0) {
        checkpointState = markStepFailed(
          checkpointState,
          task.id,
          classifyFailure(raw.exitCode, raw.stderr ?? ''),
          raw.exitCode,
          `agent exited with code ${raw.exitCode}`,
          this.timestamp(),
        );
      } else {
        const failedChecks = checks.filter((check) => !check.pass).map((check) => check.name);
        checkpointState = markStepFailed(
          checkpointState,
          task.id,
          'fatal',
          0,
          `functional checks failed: ${failedChecks.join(', ')}`,
          this.timestamp(),
        );
      }
      await this.deps.checkpoints?.save(checkpointState);

      tasks.push({
        taskId: task.id,
        status: taskPassed ? 'passed' : 'failed',
        artifactsDir,
      });
    }

    return { runId: plan.runId, tasks };
  }

  private timestamp(): string {
    return (this.deps.clock?.now() ?? new Date()).toISOString();
  }
}

function checkpointDir(runDir: string, checkpointName: string): string {
  return path.join(runDir, 'checkpoints', checkpointName);
}

function shouldSavePreRunSnapshot(
  state: CheckpointState | undefined,
  restoreCheckpoints: Record<string, string> | undefined,
): boolean {
  return (
    !hasRestoreCheckpoints(restoreCheckpoints) &&
    (!state || state.steps.every((step) => step.status === 'pending'))
  );
}

function hasRestoreCheckpoints(restoreCheckpoints: Record<string, string> | undefined): boolean {
  return restoreCheckpoints !== undefined && Object.keys(restoreCheckpoints).length > 0;
}
