import { execFile } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import type {
  EvaluationCellSpec,
  TreatmentApplicationReceipt,
} from '../domain/evaluation';
import type { EvaluationTreatmentMaterializer } from '../ports/EvaluationTreatmentMaterializer';
import { assertSha256, sha256File, treeSha256 } from './EvaluationFiles';

const execFileAsync = promisify(execFile);

export class CommandEvaluationTreatmentMaterializer
  implements EvaluationTreatmentMaterializer
{
  constructor(
    private readonly materializerPath = path.resolve(
      'benchmark/candidates/e13/materialize-candidate.mjs',
    ),
  ) {}

  async materializeAndApply(
    cell: EvaluationCellSpec,
    workspaceDir: string,
    scratchDir: string,
  ): Promise<{
    receipt: TreatmentApplicationReceipt;
    receiptBytes: Buffer;
    appliedWorkspaceSha256: string;
  }> {
    const manifest = await this.preflight(cell);
    if (!manifest.candidateId) throw new Error(`treatment manifest has no candidate id for ${cell.id}`);
    const candidateId = manifest.candidateId;

    const stagedDir = path.join(scratchDir, 'treatment-staged');
    const receiptsDir = path.join(scratchDir, 'treatment-receipts');
    const materializationReceipt = path.join(receiptsDir, 'materialize.json');
    const applicationReceipt = path.join(receiptsDir, 'apply.json');
    await mkdir(receiptsDir, { recursive: true });
    const common = [
      '--manifest',
      cell.treatment.path,
      '--source-root',
      cell.treatment.sourceRoot,
      '--profile',
      cell.treatment.profile,
      '--platform',
      cell.treatment.platform,
    ];
    const cache = cell.treatment.artifactCache
      ? ['--artifact-cache', cell.treatment.artifactCache]
      : [];
    await execFileAsync(
      process.execPath,
      [
        this.materializerPath,
        'materialize',
        ...common,
        '--target',
        stagedDir,
        '--receipt',
        materializationReceipt,
        ...cache,
      ],
      { maxBuffer: 16 * 1024 * 1024 },
    );
    await execFileAsync(
      process.execPath,
      [
        this.materializerPath,
        'apply',
        ...common,
        '--target',
        workspaceDir,
        '--staged',
        stagedDir,
        '--materialization-receipt',
        materializationReceipt,
        '--receipt',
        applicationReceipt,
      ],
      { maxBuffer: 16 * 1024 * 1024 },
    );
    const receiptBytes = await readFile(applicationReceipt);
    const receipt = JSON.parse(receiptBytes.toString('utf8')) as TreatmentApplicationReceipt;
    assertApplicationReceipt(receipt, cell, candidateId);
    return {
      receipt,
      receiptBytes,
      appliedWorkspaceSha256: await treeSha256(workspaceDir, true),
    };
  }

  async preflight(cell: EvaluationCellSpec): Promise<{ candidateId?: string }> {
    if ((await sha256File(cell.treatment.path)) !== cell.treatment.sha256) {
      throw new Error(`treatment manifest checksum mismatch for ${cell.id}`);
    }
    const manifest = JSON.parse(await readFile(cell.treatment.path, 'utf8')) as {
      candidateId?: string;
      materializer?: { sha256?: string };
    };
    if (!manifest.candidateId) throw new Error(`treatment manifest has no candidate id for ${cell.id}`);
    assertSha256(manifest.materializer?.sha256, 'treatment materializer sha256');
    if ((await sha256File(this.materializerPath)) !== manifest.materializer.sha256) {
      throw new Error(`treatment materializer checksum mismatch for ${cell.id}`);
    }
    return manifest;
  }
}

function assertApplicationReceipt(
  receipt: TreatmentApplicationReceipt,
  cell: EvaluationCellSpec,
  candidateId: string,
): void {
  if (
    receipt.schemaVersion !== 1 ||
    receipt.operation !== 'apply' ||
    receipt.candidateId !== candidateId ||
    receipt.activationProfile !== cell.treatment.profile ||
    receipt.platform !== cell.treatment.platform ||
    receipt.manifestSha256 !== cell.treatment.sha256 ||
    receipt.visibleInstructionProof?.allDeclaredInstructionsVisible !== true
  ) {
    throw new Error(`treatment application receipt identity mismatch for ${cell.id}`);
  }
  for (const label of [
    'applicationPolicySha256',
    'materializationReceiptSha256',
    'originalTreeSha256',
    'stagedTreeSha256',
    'resultingTreeSha256',
  ] as const) {
    assertSha256(receipt[label], `application receipt ${label}`);
  }
  if (!Array.isArray(receipt.files) || receipt.files.length === 0) {
    throw new Error(`treatment application receipt has no files for ${cell.id}`);
  }
}
