import { execFile } from 'node:child_process';
import { lstat, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type { EvaluationCellSpec } from '../domain/evaluation';
import type {
  EvaluationWorkspace,
  PreparedEvaluationWorkspace,
} from '../ports/EvaluationWorkspace';
import { canonicalJson, listFiles, sha256, treeSha256 } from './EvaluationFiles';

const execFileAsync = promisify(execFile);

interface FixtureReceipt {
  schemaVersion: number;
  taskId: string;
  fixtureSha256: string;
  startCommit: string;
  materializedTreeSha256: string;
}

export class Phase0EvaluationWorkspace implements EvaluationWorkspace {
  private readonly baselines = new Map<string, Record<string, string>>();
  async prepare(cell: EvaluationCellSpec, corpusRoot: string): Promise<PreparedEvaluationWorkspace> {
    const rootDir = await mkdtemp(path.join(tmpdir(), `harness-evaluation-${safe(cell.id)}-`));
    const workspaceDir = path.join(rootDir, 'workspace');
    const submissionDir = path.join(rootDir, 'submission');
    const fixtureReceiptPath = path.join(rootDir, 'receipts', 'fixture.json');
    try {
      await execFileAsync(
        process.execPath,
        [
          path.join(corpusRoot, 'materialize-fixture.mjs'),
          '--task',
          cell.taskId,
          '--output',
          workspaceDir,
          '--receipt',
          fixtureReceiptPath,
        ],
        { maxBuffer: 4 * 1024 * 1024 },
      );
      await mkdir(submissionDir, { recursive: true });
      const receipt = JSON.parse(await readFile(fixtureReceiptPath, 'utf8')) as FixtureReceipt;
      if (receipt.schemaVersion !== 1 || receipt.taskId !== cell.taskId) {
        throw new Error(`fixture receipt identity mismatch for ${cell.id}`);
      }
      return {
        rootDir,
        workspaceDir,
        submissionDir,
        fixtureReceiptPath,
        fixture: {
          taskId: receipt.taskId,
          fixtureSha256: receipt.fixtureSha256,
          startCommit: receipt.startCommit,
          materializedTreeSha256: receipt.materializedTreeSha256,
        },
        beforeSha256: await this.digest(workspaceDir),
      };
    } catch (error) {
      await rm(rootDir, { recursive: true, force: true });
      throw error;
    }
  }

  digest(workspaceDir: string): Promise<string> {
    return treeSha256(workspaceDir, true);
  }

  async prepareRubricStart(prepared: PreparedEvaluationWorkspace): Promise<{
    path: string;
    bytes: Buffer;
  }> {
    const original = JSON.parse(await readFile(prepared.fixtureReceiptPath, 'utf8')) as Record<string, unknown>;
    const files: Record<string, string> = {};
    for (const relative of await listFiles(prepared.workspaceDir, true)) {
      files[relative] = sha256(await readFile(path.join(prepared.workspaceDir, relative)));
    }
    const receipt = {
      ...original,
      materializedTreeSha256: sha256(compactCanonical({ files })),
      files,
    };
    const receiptPath = path.join(prepared.rootDir, 'receipts', 'rubric-start.json');
    const bytes = Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`, 'utf8');
    await writeFile(receiptPath, bytes, { flag: 'wx' });
    this.baselines.set(prepared.workspaceDir, files);
    return { path: receiptPath, bytes };
  }

  async diff(workspaceDir: string): Promise<Buffer> {
    const baseline = this.baselines.get(workspaceDir);
    if (!baseline) throw new Error(`workspace baseline is unavailable: ${workspaceDir}`);
    const currentPaths = await listFiles(workspaceDir, true);
    const current = new Map<string, { sha256: string; mode: number; contentBase64: string }>();
    for (const relative of currentPaths) {
      const absolute = path.join(workspaceDir, relative);
      const bytes = await readFile(absolute);
      const { mode } = await lstat(absolute);
      current.set(relative, {
        sha256: sha256(bytes),
        mode: mode & 0o777,
        contentBase64: bytes.toString('base64'),
      });
    }
    const paths = [...new Set([...Object.keys(baseline), ...current.keys()])].sort();
    const changes = paths.flatMap((relative) => {
      const beforeSha256 = baseline[relative] ?? null;
      const after = current.get(relative);
      if (beforeSha256 === after?.sha256) return [];
      return [{
        path: relative,
        beforeSha256,
        afterSha256: after?.sha256 ?? null,
        mode: after?.mode ?? null,
        contentBase64: after?.contentBase64 ?? null,
      }];
    });
    return Buffer.from(canonicalJson({ schemaVersion: 1, changes }), 'utf8');
  }

  dispose(rootDir: string): Promise<void> {
    for (const workspaceDir of this.baselines.keys()) {
      if (workspaceDir.startsWith(`${rootDir}${path.sep}`)) this.baselines.delete(workspaceDir);
    }
    return rm(rootDir, { recursive: true, force: true });
  }
}

function compactCanonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(compactCanonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value as Record<string, unknown>)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${compactCanonical((value as Record<string, unknown>)[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function safe(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]/g, '-');
}
