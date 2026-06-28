import type { CheckpointState } from '../domain/checkpoint';

export interface CheckpointStore {
  load(runId: string): Promise<CheckpointState | null>;
  save(state: CheckpointState): Promise<void>;
}
