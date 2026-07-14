import type { EvaluationCellSpec, TreatmentApplicationReceipt } from '../domain/evaluation';

export interface EvaluationTreatmentMaterializer {
  preflight(cell: EvaluationCellSpec): Promise<{ candidateId?: string }>;
  materializeAndApply(
    cell: EvaluationCellSpec,
    workspaceDir: string,
    scratchDir: string,
  ): Promise<{
    receipt: TreatmentApplicationReceipt;
    receiptBytes: Buffer;
    appliedWorkspaceSha256: string;
  }>;
}
