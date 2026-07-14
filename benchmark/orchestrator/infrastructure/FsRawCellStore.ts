import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { RawCellRecord } from '../domain/evaluation';
import type { RawCellStore } from '../ports/RawCellStore';
import { canonicalJson } from './EvaluationFiles';

export class FsRawCellStore implements RawCellStore {
  constructor(private readonly runDir: string) {}

  async stageEvidence(
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
  ): Promise<NonNullable<RawCellRecord['evidence']>> {
    const safeId = safe(cellId);
    const evidenceDir = path.join(this.runDir, 'evidence', safeId);
    await mkdir(evidenceDir, { recursive: true });
    const entries = [
      ['stdout', 'stdout.bin'],
      ['stderr', 'stderr.bin'],
      ['fixtureReceipt', 'fixture-receipt.json'],
      ['rubricStartReceipt', 'rubric-start-receipt.json'],
      ['metricsReceipt', 'metrics-receipt.json'],
      ['workspaceDiff', 'workspace-diff.bin'],
      ['scoreReceipt', 'score-receipt.json'],
      ['treatmentApplicationReceipt', 'treatment-application-receipt.json'],
    ] as const;
    const refs = {} as NonNullable<RawCellRecord['evidence']>;
    for (const [name, fileName] of entries) {
      const bytes = evidence[name];
      const relative = path.posix.join('evidence', safeId, fileName);
      await writeFile(path.join(this.runDir, relative), bytes, { flag: 'wx' });
      refs[name] = { path: relative, sha256: sha256(bytes) };
    }
    return refs;
  }

  async write(record: RawCellRecord): Promise<void> {
    const cellDir = path.join(this.runDir, 'cells');
    await mkdir(cellDir, { recursive: true });
    await writeFile(path.join(cellDir, `${safe(record.cellId)}.json`), canonicalJson(record), {
      flag: 'wx',
    });
  }
}

function sha256(value: Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function safe(value: string): string {
  if (!/^[A-Za-z0-9._-]+$/.test(value)) throw new Error(`unsafe cell id: ${value}`);
  return value;
}
