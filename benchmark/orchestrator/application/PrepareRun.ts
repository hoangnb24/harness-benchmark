import { createInitialCheckpointState, type CheckpointState } from '../domain/checkpoint';
import type { RunPlan } from '../domain/task';
import type { CheckpointStore } from '../ports/CheckpointStore';

export interface PrepareRunConfig {
  agent: string;
  model?: string;
  harnessRef: string;
  workspaceDir: string;
}

export interface PreparedRun {
  state: CheckpointState;
  taskIds: string[];
}

export class PrepareRun {
  constructor(private readonly checkpoints: CheckpointStore) {}

  async prepare(plan: RunPlan, config: PrepareRunConfig): Promise<PreparedRun> {
    const taskIds = plan.tasks.map((task) => task.id);
    const state = createInitialCheckpointState({
      runId: plan.runId,
      agent: config.agent,
      model: config.model,
      harnessRef: config.harnessRef,
      workspaceDir: config.workspaceDir,
      taskIds,
    });

    await this.checkpoints.save(state);
    return { state, taskIds };
  }
}
