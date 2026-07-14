import type { EvaluationCellSpec, TreatmentApplicationReceipt } from '../domain/evaluation';

export interface EvaluationTreatmentMaterializer {
  materializeAndApply(
    cell: EvaluationCellSpec,
    workspaceDir: string,
    scratchDir: string,
  ): Promise<{ receipt: TreatmentApplicationReceipt; receiptBytes: Buffer }>;
}
