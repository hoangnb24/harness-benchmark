import type { ResumePlan } from './ResumeRun';
import type { RunPlan, TaskDefinition } from '../domain/task';

export interface RunExecutionPlan {
  plan: RunPlan;
  restoreCheckpoints: Record<string, string>;
}

export class BuildRunExecutionPlan {
  fromResumePlan(fullPlan: RunPlan, resumePlan: ResumePlan): RunExecutionPlan {
    const tasksById = new Map(fullPlan.tasks.map((task) => [task.id, task]));
    const selectedTaskIds = new Set(resumePlan.steps.map((step) => step.task));
    const tasks = resumePlan.steps.map((step) => {
      const task = tasksById.get(step.task);
      if (!task) {
        throw new Error(`resume plan references unknown task: ${step.task}`);
      }

      return {
        ...task,
        dependencies: task.dependencies.filter((dependency) => selectedTaskIds.has(dependency)),
      };
    });

    return {
      plan: { runId: fullPlan.runId, tasks },
      restoreCheckpoints: restoreCheckpointsFor(resumePlan, tasks),
    };
  }
}

function restoreCheckpointsFor(
  resumePlan: ResumePlan,
  tasks: TaskDefinition[],
): Record<string, string> {
  const taskIds = new Set(tasks.map((task) => task.id));
  return Object.fromEntries(
    resumePlan.steps
      .filter((step) => step.restoreCheckpoint && taskIds.has(step.task))
      .map((step) => [step.task, step.restoreCheckpoint as string]),
  );
}
