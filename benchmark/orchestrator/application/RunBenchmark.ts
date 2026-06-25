import { validateRunPlan, type RunPlan, type TaskResult } from '../domain/task';
import type { AgentAdapter, AgentInvocationContext } from '../ports/AgentAdapter';
import type { FunctionalProbe } from '../ports/FunctionalProbe';

export interface RunBenchmarkDeps {
  agent: AgentAdapter;
  functional: FunctionalProbe;
}

export interface RunBenchmarkContext {
  projectDir: string;
  runDir: string;
  model?: string;
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
    for (const task of plan.tasks) {
      const artifactsDir = `${context.runDir}/${task.id}`;
      const invocationContext: AgentInvocationContext = {
        runId: plan.runId,
        projectDir: context.projectDir,
        artifactsDir,
        model: context.model,
      };

      const raw = await this.deps.agent.invoke(task, invocationContext);
      const checks = await this.deps.functional.run(task, context.projectDir);
      const checksPassed = checks.every((check) => check.pass);

      tasks.push({
        taskId: task.id,
        status: raw.exitCode === 0 && checksPassed ? 'passed' : 'failed',
        artifactsDir,
      });
    }

    return { runId: plan.runId, tasks };
  }
}
