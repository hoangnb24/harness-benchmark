import { createHash } from 'node:crypto';
import { cp, mkdtemp, readFile, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runEvaluationCli } from '../interface/evaluation-cli';
import { FakeEvaluationAgent } from '../infrastructure/FakeEvaluationAgent';
import { treeSha256 } from '../infrastructure/EvaluationFiles';
import { Phase0RubricEvaluator } from '../infrastructure/Phase0RubricEvaluator';

const roots: string[] = [];
const repositoryRoot = path.resolve('.');
const sourceRoot = path.resolve('../repository-harness');
const candidateRoot = path.join(
  sourceRoot,
  'docs/stories/epics/E13-phase-0-product-shape-evaluation/evidence/candidates',
);

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('Phase 0 evaluation qualification', () => {
  it('runs the real fixture, candidate apply, fake agent, rubric, evidence, report, and verifier', async () => {
    const root = await temporary();
    const runDir = path.join(root, 'run');
    const agentPath = path.join(root, 'passing-agent.mjs');
    await writeFile(
      agentPath,
      [
        "import { mkdir, readFile, writeFile } from 'node:fs/promises';",
        "const readme = await readFile('README.md', 'utf8');",
        "await writeFile('README.md', readme.replace('npm start', 'npm run dev'));",
        "await mkdir(process.env.EVALUATION_SUBMISSION, { recursive: true });",
        "await writeFile(`${process.env.EVALUATION_SUBMISSION}/proof.md`, 'checked package.json\\n');",
      ].join('\n'),
    );
    const planPath = await plan(root, {
      agentPath,
      manifestName: 'copy-once',
      cells: [cell('doc-pass', 'P0-A03-doc-command', 'tiny-documentation', 0)],
    });
    const output: string[] = [];
    const errors: string[] = [];
    const io = { stdout: (value: string) => output.push(value), stderr: (value: string) => errors.push(value) };

    const qualifyCode = await runEvaluationCli(['qualify', '--plan', planPath, '--run-dir', runDir], io);
    expect({ qualifyCode, errors }).toEqual({ qualifyCode: 0, errors: [] });
    expect(await runEvaluationCli(['report', '--plan', planPath, '--run-dir', runDir], io)).toBe(0);
    expect(await runEvaluationCli(['verify', '--plan', planPath, '--run-dir', runDir], io)).toBe(0);

    const record = JSON.parse(await readFile(path.join(runDir, 'cells/doc-pass.json'), 'utf8'));
    expect(record.status).toBe('passed');
    expect(record.workspace.disposed).toBe(true);
    expect(record.rubric.effective.every((check: { effectivePass: boolean }) => check.effectivePass)).toBe(true);
    expect(record.identities.treatment.candidateId).toBe('COPY_ONCE');
    expect(record.evidence).toMatchObject({
      stdout: { path: 'evidence/doc-pass/stdout.bin' },
      workspaceDiff: { path: 'evidence/doc-pass/workspace-diff.bin' },
      scoreReceipt: { path: 'evidence/doc-pass/score-receipt.json' },
      treatmentApplicationReceipt: {
        path: 'evidence/doc-pass/treatment-application-receipt.json',
      },
    });
    const aggregate = JSON.parse(await readFile(path.join(runDir, 'aggregate.json'), 'utf8'));
    expect(aggregate).toMatchObject({ primaryPass: 4, primaryTotal: 4, unknownMetrics: 6 });
  }, 30_000);

  it('makes a non-zero process exit authoritative even when rubric checks pass', async () => {
    const root = await temporary();
    const runDir = path.join(root, 'run');
    const agentPath = path.join(root, 'failing-agent.mjs');
    await writeFile(
      agentPath,
      [
        "import { mkdir, readFile, writeFile } from 'node:fs/promises';",
        "const readme = await readFile('README.md', 'utf8');",
        "await writeFile('README.md', readme.replace('npm start', 'npm run dev'));",
        "await mkdir(process.env.EVALUATION_SUBMISSION, { recursive: true });",
        "await writeFile(`${process.env.EVALUATION_SUBMISSION}/proof.md`, 'checked package.json\\n');",
        'process.exitCode = 7;',
      ].join('\n'),
    );
    const planPath = await plan(root, {
      agentPath,
      manifestName: 'copy-once',
      cells: [cell('process-failure', 'P0-A03-doc-command', 'tiny-documentation', 0)],
    });
    expect(await runEvaluationCli(['qualify', '--plan', planPath, '--run-dir', runDir], quiet())).toBe(0);
    const record = JSON.parse(await readFile(path.join(runDir, 'cells/process-failure.json'), 'utf8'));
    expect(record.process.exitCode).toBe(7);
    expect(record.status).toBe('failed');
    expect(record.rubric.observed.every((check: { pass: boolean }) => check.pass)).toBe(true);
    expect(record.rubric.effective.every((check: { effectivePass: boolean }) => !check.effectivePass)).toBe(true);
  }, 30_000);

  it('rejects evidence, raw identity/metric/denominator, cell-set, and aggregate tampering', async () => {
    const root = await temporary();
    const runDir = path.join(root, 'run');
    const agentPath = path.join(root, 'agent.mjs');
    await writeFile(
      agentPath,
      "import {mkdir,writeFile} from 'node:fs/promises'; await mkdir(process.env.EVALUATION_SUBMISSION,{recursive:true}); await writeFile(`${process.env.EVALUATION_SUBMISSION}/response.md`, 'requestTimeoutMs 1500 upstreamTimeoutMs 5000 read-only');\n",
    );
    const planPath = await plan(root, {
      agentPath,
      manifestName: 'copy-once',
      cells: [cell('tamper', 'P0-A01-diagnose-timeout', 'read-only-diagnosis', 0)],
    });
    expect(await runEvaluationCli(['qualify', '--plan', planPath, '--run-dir', runDir], quiet())).toBe(0);
    expect(await runEvaluationCli(['report', '--plan', planPath, '--run-dir', runDir], quiet())).toBe(0);
    const cases: Array<[string, (caseDir: string) => Promise<void>]> = [
      ['evidence', async (caseDir) => writeFile(path.join(caseDir, 'evidence/tamper/stdout.bin'), 'altered')],
      ['raw-identity', async (caseDir) => mutateRaw(caseDir, (raw) => { raw.identities.runner.commit = 'altered'; })],
      ['raw-treatment', async (caseDir) => mutateRaw(caseDir, (raw) => { raw.identities.treatment.sha256 = sha('other'); })],
      ['metric-zero', async (caseDir) => mutateRaw(caseDir, (raw) => { raw.metrics.costUsd = { status: 'known', value: 0 }; })],
      ['denominator', async (caseDir) => mutateRaw(caseDir, (raw) => {
        raw.identities.rubric.checkIds.pop();
        raw.rubric.expectedCheckIds.pop();
        raw.rubric.observed.pop();
        raw.rubric.effective.pop();
      })],
      ['extra-cell', async (caseDir) => writeFile(path.join(caseDir, 'cells/extra.json'), '{}')],
      ['missing-cell', async (caseDir) => unlink(path.join(caseDir, 'cells/tamper.json'))],
      ['aggregate', async (caseDir) => {
        const aggregatePath = path.join(caseDir, 'aggregate.json');
        const aggregate = JSON.parse(await readFile(aggregatePath, 'utf8'));
        aggregate.primaryPass = 0;
        await writeFile(aggregatePath, JSON.stringify(aggregate));
      }],
    ];
    for (const [name, mutate] of cases) {
      const caseDir = path.join(root, `case-${name}`);
      await cp(runDir, caseDir, { recursive: true });
      await mutate(caseDir);
      expect(
        await runEvaluationCli(['verify', '--plan', planPath, '--run-dir', caseDir], quiet()),
        name,
      ).toBe(1);
    }
  }, 30_000);

  it('rejects missing plan identity, treatment mismatch, and atomic dependencies before invocation', async () => {
    const root = await temporary();
    const agentPath = path.join(root, 'never-run.mjs');
    await writeFile(agentPath, "throw new Error('must not run');\n");
    const planPath = await plan(root, {
      agentPath,
      manifestName: 'copy-once',
      cells: [cell('preflight', 'P0-A01-diagnose-timeout', 'read-only-diagnosis', 0)],
    });
    const base = JSON.parse(await readFile(planPath, 'utf8'));
    for (const [name, mutate] of [
      ['identity-missing', (value: any) => { delete value.sandbox; }],
      ['treatment-mismatch', (value: any) => { value.cells[0].treatment.sha256 = sha('mismatch'); }],
      ['atomic-dependency', (value: any) => { value.cells[0].dependencies = ['prior']; }],
    ] as const) {
      const altered = structuredClone(base);
      mutate(altered);
      const alteredPath = path.join(root, `${name}.json`);
      await writeFile(alteredPath, JSON.stringify(altered));
      expect(
        await runEvaluationCli(['qualify', '--plan', alteredPath, '--run-dir', path.join(root, name)], quiet()),
        name,
      ).toBe(1);
    }
  });

  it('blocks a cumulative dependent cell after its prerequisite process fails', async () => {
    const root = await temporary();
    const runDir = path.join(root, 'run');
    const agentPath = path.join(root, 'failing-prerequisite.mjs');
    await writeFile(agentPath, 'process.exitCode = 9;\n');
    const first = cell('prerequisite', 'P0-A03-doc-command', 'tiny-documentation', 0);
    const second = {
      ...cell('dependent', 'P0-A01-diagnose-timeout', 'read-only-diagnosis', 1),
      mode: 'cumulative' as const,
      dependencies: ['prerequisite'],
    };
    const planPath = await plan(root, { agentPath, manifestName: 'copy-once', cells: [first, second as any] });
    expect(await runEvaluationCli(['qualify', '--plan', planPath, '--run-dir', runDir], quiet())).toBe(0);
    expect(await runEvaluationCli(['report', '--plan', planPath, '--run-dir', runDir], quiet())).toBe(0);
    const dependent = JSON.parse(await readFile(path.join(runDir, 'cells/dependent.json'), 'utf8'));
    expect(dependent).toMatchObject({
      status: 'blocked_dependency',
      blockedBy: ['prerequisite'],
      process: { exitCode: null },
      workspace: { disposed: true },
    });
  }, 30_000);

  it('rejects a missing rubric and any rubric content not frozen by the corpus lock', async () => {
    const root = await temporary();
    const sourceCorpus = path.join(repositoryRoot, 'benchmark/phase0');
    for (const variant of ['missing', 'unused'] as const) {
      const corpusRoot = path.join(root, variant);
      const { mkdir } = await import('node:fs/promises');
      await mkdir(corpusRoot);
      const catalog = JSON.parse(await readFile(path.join(sourceCorpus, 'atomic-catalog.json'), 'utf8'));
      const lock = JSON.parse(await readFile(path.join(sourceCorpus, 'corpus-lock.json'), 'utf8'));
      const task = catalog.tasks.find((entry: { id: string }) => entry.id === 'P0-A01-diagnose-timeout');
      if (variant === 'missing') delete task.rubric;
      else {
        task.rubric.checks.push({ id: 'unused-extra', kind: 'contains', scope: 'submission', path: 'never', values: ['never'] });
        task.rubric.denominator += 1;
      }
      lock.atomicCatalogSha256 = sha(compactCanonical(catalog));
      const catalogPath = path.join(corpusRoot, 'atomic-catalog.json');
      const lockPath = path.join(corpusRoot, 'corpus-lock.json');
      await writeFile(catalogPath, JSON.stringify(catalog));
      await writeFile(lockPath, JSON.stringify(lock));
      const evaluator = new Phase0RubricEvaluator({
        lockSha256: await fileSha(lockPath),
        atomicCatalogSha256: lock.atomicCatalogSha256,
      });
      await expect(evaluator.load({
        id: variant,
        taskId: 'P0-A01-diagnose-timeout',
        mode: 'atomic',
        dependencies: [],
        treatment: { path: 'x', sha256: sha('x'), sourceRoot: 'x', profile: 'x', platform: 'x' },
        timeoutSeconds: 1,
        order: { repetition: 0, position: 0 },
      }, corpusRoot), variant).rejects.toThrow();
    }
  });

  it('kills the entire fake-agent process group on timeout', async () => {
    const root = await temporary();
    const marker = path.join(root, 'descendant-contamination.txt');
    const workspace = path.join(root, 'workspace');
    const submission = path.join(root, 'submission');
    await Promise.all([writeFile(path.join(root, 'timeout-agent.mjs'), [
      "import {spawn} from 'node:child_process';",
      `spawn(process.execPath, ['-e', ${JSON.stringify(`setTimeout(()=>require('fs').writeFileSync(${JSON.stringify(marker)},'leak'),500)`) }], {stdio:'ignore'});`,
      'setTimeout(() => {}, 10_000);',
    ].join('\n')), rm(workspace, { recursive: true, force: true }), rm(submission, { recursive: true, force: true })]);
    const { mkdir } = await import('node:fs/promises');
    await Promise.all([mkdir(workspace), mkdir(submission)]);
    const result = await new FakeEvaluationAgent(process.execPath, [path.join(root, 'timeout-agent.mjs')]).execute({
      cell: {
        id: 'timeout',
        taskId: 'P0-A01-diagnose-timeout',
        mode: 'atomic',
        dependencies: [],
        treatment: {
          path: 'unused',
          sha256: sha('unused'),
          sourceRoot: 'unused',
          profile: 'read-only-diagnosis',
          platform: 'test',
        },
        timeoutSeconds: 0.1,
        order: { repetition: 0, position: 0 },
      },
      workspaceDir: workspace,
      submissionDir: submission,
      prompt: 'prompt',
    });
    expect(result).toMatchObject({ exitCode: 124, timedOut: true });
    await new Promise((resolve) => setTimeout(resolve, 700));
    await expect(readFile(marker)).rejects.toThrow();
  });

  it('rejects symlinks from evaluation tree identities', async () => {
    const root = await temporary();
    await writeFile(path.join(root, 'outside.txt'), 'host-dependent');
    const tree = path.join(root, 'tree');
    const { mkdir } = await import('node:fs/promises');
    await mkdir(tree);
    await symlink(path.join(root, 'outside.txt'), path.join(tree, 'escape'));
    await expect(treeSha256(tree)).rejects.toThrow('symbolic links are not allowed');
  });
});

async function plan(
  root: string,
  input: { agentPath: string; manifestName: string; cells: ReturnType<typeof cell>[] },
): Promise<string> {
  const corpusRoot = path.join(repositoryRoot, 'benchmark/phase0');
  const manifestPath = path.join(candidateRoot, `${input.manifestName}.json`);
  const value = {
    version: 1,
    runId: `qualification-${path.basename(root)}`,
    runner: { repository: 'harness-benchmark', commit: 'test-commit' },
    agent: { kind: 'fake', command: process.execPath, args: [input.agentPath] },
    model: {
      declared: 'deterministic-fake',
      provider: 'local',
      runtime: process.version,
      resolved: { status: 'known', value: 'deterministic-fake' },
    },
    sandbox: 'disposable-temp-directory',
    toolCatalogSha256: sha('fake-agent-only'),
    corpus: {
      root: corpusRoot,
      lockSha256: await fileSha(path.join(corpusRoot, 'corpus-lock.json')),
      atomicCatalogSha256: sha(compactCanonical(JSON.parse(
        await readFile(path.join(corpusRoot, 'atomic-catalog.json'), 'utf8'),
      ))),
    },
    cells: await Promise.all(input.cells.map(async (entry) => ({
      ...entry,
      treatment: {
        path: manifestPath,
        sha256: await fileSha(manifestPath),
        sourceRoot,
        profile: entry.treatment.profile,
        platform: process.platform === 'darwin' ? `macos-${process.arch}` : `${process.platform}-${process.arch}`,
      },
    }))),
  };
  const planPath = path.join(root, 'plan.json');
  await writeFile(planPath, JSON.stringify(value, null, 2));
  return planPath;
}

function cell(id: string, taskId: string, profile: string, position: number) {
  return {
    id,
    taskId,
    mode: 'atomic' as const,
    dependencies: [] as string[],
    treatment: { profile },
    timeoutSeconds: 5,
    order: { repetition: 0, position },
  };
}

async function fileSha(filePath: string): Promise<string> {
  return sha(await readFile(filePath));
}

function sha(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
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

async function temporary(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'evaluation-qualification-test-'));
  roots.push(root);
  return root;
}

function quiet() {
  return { stdout: (_value: string) => undefined, stderr: (_value: string) => undefined };
}

async function mutateRaw(runDir: string, mutate: (raw: any) => void): Promise<void> {
  const rawPath = path.join(runDir, 'cells/tamper.json');
  const raw = JSON.parse(await readFile(rawPath, 'utf8'));
  mutate(raw);
  await writeFile(rawPath, JSON.stringify(raw));
}
