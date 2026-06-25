export type RiskLane = 'tiny' | 'normal' | 'high_risk';

export interface TaskDefinition {
  id: string;
  title: string;
  promptPath: string;
  rubricPath: string;
  expectedLane: RiskLane;
  dependencies: string[];
  functionalCheckPath?: string;
}

export interface RunPlan {
  runId: string;
  tasks: TaskDefinition[];
}

export interface TaskResult {
  taskId: string;
  status: 'passed' | 'failed';
  artifactsDir: string;
}

export function validateRunPlan(plan: RunPlan): void {
  const seen = new Set<string>();

  for (const task of plan.tasks) {
    if (seen.has(task.id)) {
      throw new Error(`duplicate task id: ${task.id}`);
    }

    for (const dependency of task.dependencies) {
      if (!seen.has(dependency)) {
        throw new Error(`task ${task.id} depends on ${dependency} before it appears in the plan`);
      }
    }

    seen.add(task.id);
  }
}
