import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import type { EvaluationCellSpec, ObservedRubricResult } from '../domain/evaluation';
import type {
  EvaluationRubricEvaluator,
  LoadedRubric,
} from '../ports/EvaluationRubricEvaluator';
import { canonicalJson, sha256, sha256File } from './EvaluationFiles';

const execFileAsync = promisify(execFile);

interface AtomicCatalog {
  tasks: Array<{
    id: string;
    prompt: string;
    rubric?: { denominator: number; checks: Array<{ id: string }> };
  }>;
}

interface CorpusLock {
  atomicCatalogSha256: string;
  atomicTasks: Array<{
    id: string;
    fixtureSha256: string;
    promptSha256: string;
    rubricSha256: string;
    startCommit: string;
  }>;
}

interface RubricOutput {
  schemaVersion: number;
  taskId: string;
  rubricSha256: string;
  denominator: number;
  results: ObservedRubricResult[];
}

export class Phase0RubricEvaluator implements EvaluationRubricEvaluator {
  constructor(private readonly expectedCorpus: { lockSha256: string; atomicCatalogSha256: string }) {}

  async load(cell: EvaluationCellSpec, corpusRoot: string): Promise<LoadedRubric> {
    const lockPath = path.join(corpusRoot, 'corpus-lock.json');
    const catalogPath = path.join(corpusRoot, 'atomic-catalog.json');
    if ((await sha256File(lockPath)) !== this.expectedCorpus.lockSha256) {
      throw new Error('corpus lock checksum mismatch');
    }
    const lock = JSON.parse(await readFile(lockPath, 'utf8')) as CorpusLock;
    if (lock.atomicCatalogSha256 !== this.expectedCorpus.atomicCatalogSha256) {
      throw new Error('corpus lock does not identify the atomic catalog');
    }
    const catalog = JSON.parse(await readFile(catalogPath, 'utf8')) as AtomicCatalog;
    if (sha256(compactCanonical(catalog)) !== this.expectedCorpus.atomicCatalogSha256) {
      throw new Error('atomic catalog semantic checksum mismatch');
    }
    const task = catalog.tasks.find((item) => item.id === cell.taskId);
    const frozen = lock.atomicTasks.find((item) => item.id === cell.taskId);
    if (!task || !frozen || !task.rubric || task.rubric.checks.length === 0) {
      throw new Error(`missing frozen task or rubric: ${cell.taskId}`);
    }
    const checkIds = task.rubric.checks.map((check) => check.id);
    if (task.rubric.denominator !== checkIds.length || new Set(checkIds).size !== checkIds.length) {
      throw new Error(`${cell.taskId} rubric denominator or ids are invalid`);
    }
    if (sha256(task.prompt) !== frozen.promptSha256) {
      throw new Error(`${cell.taskId} prompt checksum differs from corpus lock`);
    }
    if (sha256(compactCanonical(task.rubric)) !== frozen.rubricSha256) {
      throw new Error(`${cell.taskId} rubric checksum differs from corpus lock`);
    }
    return {
      taskId: cell.taskId,
      fixtureSha256: frozen.fixtureSha256,
      startCommit: frozen.startCommit,
      prompt: task.prompt,
      promptSha256: frozen.promptSha256,
      rubricSha256: frozen.rubricSha256,
      rubricRunnerSha256: await sha256File(path.join(corpusRoot, 'rubric-runner.mjs')),
      checkIds,
    };
  }

  async evaluate(input: {
    rubric: LoadedRubric;
    corpusRoot: string;
    workspaceDir: string;
    submissionDir: string;
    fixtureReceiptPath: string;
    scoreReceiptPath: string;
  }): Promise<{ results: ObservedRubricResult[]; receiptSha256: string }> {
    if ((await sha256File(path.join(input.corpusRoot, 'corpus-lock.json'))) !== this.expectedCorpus.lockSha256) {
      throw new Error('corpus lock changed during evaluation');
    }
    const catalog = JSON.parse(
      await readFile(path.join(input.corpusRoot, 'atomic-catalog.json'), 'utf8'),
    ) as AtomicCatalog;
    if (sha256(compactCanonical(catalog)) !== this.expectedCorpus.atomicCatalogSha256) {
      throw new Error('atomic catalog changed during evaluation');
    }
    if ((await sha256File(path.join(input.corpusRoot, 'rubric-runner.mjs'))) !== input.rubric.rubricRunnerSha256) {
      throw new Error('rubric runner changed during evaluation');
    }
    let stdout: string;
    try {
      stdout = (
        await execFileAsync(
          process.execPath,
          [
            path.join(input.corpusRoot, 'rubric-runner.mjs'),
            '--task',
            input.rubric.taskId,
            '--workspace',
            input.workspaceDir,
            '--submission',
            input.submissionDir,
            '--receipt',
            input.fixtureReceiptPath,
          ],
          { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 },
        )
      ).stdout;
    } catch (error) {
      const output = (error as { stdout?: string }).stdout;
      if (!output) throw error;
      stdout = output;
    }
    const score = JSON.parse(stdout) as RubricOutput;
    if (
      score.schemaVersion !== 1 ||
      score.taskId !== input.rubric.taskId ||
      score.rubricSha256 !== input.rubric.rubricSha256 ||
      score.denominator !== input.rubric.checkIds.length ||
      score.results.map((result) => result.id).join('\0') !== input.rubric.checkIds.join('\0')
    ) {
      throw new Error(`rubric receipt identity mismatch for ${input.rubric.taskId}`);
    }
    const receipt = canonicalJson(score);
    await mkdir(path.dirname(input.scoreReceiptPath), { recursive: true });
    await writeFile(input.scoreReceiptPath, receipt, { flag: 'wx' });
    return { results: score.results, receiptSha256: sha256(receipt) };
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
