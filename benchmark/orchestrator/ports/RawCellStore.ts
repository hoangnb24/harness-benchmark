import type { RawCellRecord } from '../domain/evaluation';

export interface RawCellStore {
  stageEvidence(
    cellId: string,
    evidence: {
      stdout: Buffer;
      stderr: Buffer;
      fixtureReceipt: Buffer;
      rubricStartReceipt: Buffer;
      metricsReceipt: Buffer;
      workspaceDiff: Buffer;
      scoreReceipt: Buffer;
      treatmentApplicationReceipt: Buffer;
    },
  ): Promise<NonNullable<RawCellRecord['evidence']>>;
  write(record: RawCellRecord): Promise<void>;
}
