import { execFile as execFileCallback } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { GenerateCalibrationAnalysis, assertBlindedReport } from '../application/GenerateCalibrationAnalysis';
import {
  assertHeldOutCalibrationPlan,
  type BlindedCalibrationObservation,
  type CalibrationAnalysisPolicy,
} from '../domain/calibration';
import type { EvaluationPlan, KnownOrUnknown } from '../domain/evaluation';
import { assertCalibrationCommandBoundary } from '../interface/evaluation-cli';

const roots: string[] = [];
const repositoryRoot = path.resolve('.');
const sourceRoot = path.resolve('../repository-harness');
const execFile = promisify(execFileCallback);

afterEach(async () => {
  delete process.env.GIT_CONFIG_GLOBAL;
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('US-030 held-out Gate D0 calibration packet', () => {
  it('locks the exact alternating, contiguous, task-local Latin-square 18-call plan', () => {
    const plan = calibrationPlan();
    expect(() => assertHeldOutCalibrationPlan(plan)).not.toThrow();
    const interleaved = structuredClone(plan);
    [interleaved.cells[1], interleaved.cells[3]] = [interleaved.cells[3], interleaved.cells[1]];
    expect(() => assertHeldOutCalibrationPlan(interleaved)).toThrow();
    const imbalanced = structuredClone(plan);
    imbalanced.cells[12].treatment = structuredClone(imbalanced.cells[13].treatment);
    expect(() => assertHeldOutCalibrationPlan(imbalanced)).toThrow();
    const decisionTask = structuredClone(plan);
    decisionTask.cells[0].taskId = 'P0-A01-diagnose-timeout';
    expect(() => assertHeldOutCalibrationPlan(decisionTask)).toThrow('decision-corpus task is forbidden');
    const renamed = structuredClone(plan);
    renamed.runId = 'renamed-calibration';
    expect(() => assertHeldOutCalibrationPlan(renamed)).toThrow('run ID differs');
    expect(() => assertCalibrationCommandBoundary('report', renamed)).toThrow('run ID differs');
    expect(() => assertCalibrationCommandBoundary('verify', renamed)).toThrow('run ID differs');
    expect(() => assertCalibrationCommandBoundary('report', plan)).toThrow('excluded from decision report');
    expect(() => assertCalibrationCommandBoundary('verify', plan)).toThrow('excluded from decision report');
  });

  it('uses df=4 Latin-square residuals, positive floors, endpoint-specific rules, and balanced upward rounding', async () => {
    const policy = await analysisPolicy(1_000_000_000);
    const observations = observationsFixture();
    const report = new GenerateCalibrationAnalysis().build(policy, observations);
    expect(report).toMatchObject({
      pooledDegreesOfFreedom: 4,
      status: 'selected',
      creditProjectionBasis: 'published-average-range-upper-end-not-cap',
      oneCallCreditOvershootPossible: true,
    });
    expect(report.balancedRequiredRepetitions! % 6).toBe(0);
    expect(report.balancedRequiredRepetitions).toBeGreaterThanOrEqual(
      Math.max(...report.endpointRequirements.map((endpoint) => endpoint.endpointRequiredRepetitions)),
    );
    expect(new Set(report.endpointRequirements.map((endpoint) => endpoint.purpose))).toEqual(
      new Set(['non-inferiority', 'material-benefit', 'guardrail']),
    );
    expect(report.endpointRequirements.filter((endpoint) => endpoint.purpose === 'non-inferiority')
      .every((endpoint) => endpoint.decisionTaskCountK === 2)).toBe(true);
    expect(report.endpointRequirements.filter((endpoint) => endpoint.purpose !== 'non-inferiority')
      .every((endpoint) => endpoint.decisionTaskCountK === 16)).toBe(true);
    expect(new Set(report.endpointRequirements.map((endpoint) => endpoint.upperVariance)).size).toBeGreaterThan(1);

    const relabeled = observations.map((observation) => ({
      ...observation,
      opaqueTreatment: ({ A: 'Q', B: 'R', C: 'P' } as Record<string, string>)[observation.opaqueTreatment],
    }));
    expect(new GenerateCalibrationAnalysis().build(policy, relabeled)).toEqual(report);

    const constant = observations.map((observation) => ({
      ...observation,
      outcomes: { correctness: known(1), proof: known(1) },
      telemetry: telemetry(100, 100, 1, 1),
    }));
    const floored = new GenerateCalibrationAnalysis().build(policy, constant);
    expect(floored.endpointRequirements.every((endpoint) => endpoint.upperVariance >= endpoint.varianceFloor)).toBe(true);
    expect(floored.endpointRequirements.every((endpoint) => endpoint.endpointRequiredRepetitions > 0)).toBe(true);
    expect(floored.balancedRequiredRepetitions).toBeGreaterThanOrEqual(6);
  });

  it('fails closed for unknown required telemetry, missing/insufficient ceiling, and extra report fields', async () => {
    const observations = observationsFixture();
    const unknown = structuredClone(observations);
    unknown[0].telemetry.inputTokens = { status: 'unknown', reason: 'stub omitted required input usage' };
    const unknownReport = new GenerateCalibrationAnalysis().build(await analysisPolicy(1_000_000_000), unknown);
    expect(unknownReport).toMatchObject({
      status: 'evidence-design-blocker',
      balancedRequiredRepetitions: null,
      selectedBalancedRepetitions: null,
    });
    expect(unknownReport.blocker).toContain('inputTokens');

    const missing = new GenerateCalibrationAnalysis().build(await analysisPolicy(null), observations);
    expect(missing.blocker).toBe('approved-human-credit-ceiling-missing');
    const insufficient = new GenerateCalibrationAnalysis().build(await analysisPolicy(1), observations);
    expect(insufficient.blocker).toBe('precision-and-power-design-exceeds-approved-credit-ceiling');
    const altered = { ...missing, treatment: 'must-not-appear' };
    expect(() => assertBlindedReport(altered as never)).toThrow('field set mismatch');
  });

  it('rebuilds identical fixture commits despite hostile global Git config and proves H02 dirty state', async () => {
    // @ts-expect-error The deterministic packet generator is an ESM artifact without declarations.
    const module = await import('../../calibration/e13/corpus/build-lock.mjs');
    const clean = await module.buildCalibrationCorpusLock();
    const root = await temporary();
    const hook = path.join(root, 'hooks/pre-commit');
    await mkdir(path.dirname(hook), { recursive: true });
    await writeFile(hook, '#!/bin/sh\nexit 91\n', { mode: 0o755 });
    const config = path.join(root, 'hostile.gitconfig');
    await writeFile(config, `[core]\n\thooksPath = ${path.dirname(hook)}\n[commit]\n\tgpgSign = true\n`);
    process.env.GIT_CONFIG_GLOBAL = config;
    expect(await module.buildCalibrationCorpusLock()).toEqual(clean);
    expect(clean.atomicTasks.find((task: { id: string }) => task.id.startsWith('H02'))).toMatchObject({
      dirtyFiles: ['LOCAL_PATCH.md'],
    });
  });

  it('verifies every packet/candidate checksum offline and rejects candidate tampering', async () => {
    // @ts-expect-error The offline packet verifier is an ESM artifact without declarations.
    const module = await import('../../calibration/e13/verify-packet.mjs');
    await expect(module.verifyPacket({ sourceRoot })).resolves.toMatchObject({
      status: 'offline-packet-verified', liveProviderCalls: 0,
    });
    const fakeSource = await temporary();
    await rm(fakeSource, { recursive: true, force: true });
    await execFile('git', ['clone', '--quiet', '--shared', sourceRoot, fakeSource]);
    await execFile('git', ['checkout', '--quiet', '--detach', 'e8c15825e7cea6d6974df98bf02b047b5ec4f593'], { cwd: fakeSource });
    const relative = 'docs/stories/epics/E13-phase-0-product-shape-evaluation/evidence/candidates';
    await writeFile(path.join(fakeSource, relative, 'copy-once.json'), '{}');
    await expect(module.verifyPacket({ sourceRoot: fakeSource })).rejects.toThrow('candidate checksum mismatch');
    const packet = JSON.parse(await readFile(path.join(repositoryRoot, 'benchmark/calibration/e13/packet-lock.json'), 'utf8'));
    const tamperedPacket = structuredClone(packet);
    tamperedPacket.plannedCalls = 17;
    expect(() => module.assertPacketLock(tamperedPacket, packet)).toThrow('packet lock');
    const corpus = JSON.parse(await readFile(path.join(repositoryRoot, 'benchmark/calibration/e13/corpus/corpus-lock.json'), 'utf8'));
    const tamperedCorpus = structuredClone(corpus);
    tamperedCorpus.atomicTasks[0].fixtureSha256 = '0'.repeat(64);
    expect(() => module.assertCorpusLock(tamperedCorpus, corpus)).toThrow('corpus lock');
  });
});

function calibrationPlan(): EvaluationPlan {
  const orders = [
    ['full-v0.json', 'copy-once.json', 'modular-core.json'],
    ['full-v0.json', 'modular-core.json', 'copy-once.json'],
    ['copy-once.json', 'modular-core.json', 'full-v0.json'],
    ['modular-core.json', 'copy-once.json', 'full-v0.json'],
    ['modular-core.json', 'full-v0.json', 'copy-once.json'],
    ['copy-once.json', 'full-v0.json', 'modular-core.json'],
  ];
  const tasks = ['H01-config-precedence', 'H02-brownfield-script-merge'];
  const digest = (name: string) => name === 'full-v0.json'
    ? '58b475c19fb38790ff8b673759ed7964293d06b677cb04734688b472eef738dd'
    : name === 'copy-once.json'
      ? '5b77e5b48dc4b9df3712e9f0239a5a219a3615644c8de317deaadc3eafcbc8dd'
      : '43b042b5e34a25050caf66b6fd2e87e87192b94f2360b48d9e3042e7b8d27023';
  return {
    version: 1, runId: 'e13-gate-d0-calibration-v4',
    runner: { repository: 'harness-benchmark', commit: '2013dd55bac4c4bbc5bd9eff950eeb6f24d999ef' },
    agent: { kind: 'codex', scope: 'calibration',
      executable: { path: '/tmp/codex', sha256: 'd'.repeat(64), version: 'test' },
      authorization: { path: '/tmp/auth', sha256: 'e'.repeat(64) }, protocol: { path: '/tmp/protocol', sha256: 'f'.repeat(64) },
      pricingPolicy: { path: '/tmp/pricing', sha256: '1'.repeat(64) }, toolPolicy: { path: '/tmp/tool', sha256: '2'.repeat(64) } },
    model: { declared: 'pinned', provider: 'openai', runtime: 'node', resolved: { status: 'unknown', reason: 'not run' } },
    reasoningEffort: 'max', sandbox: 'workspace-write', toolCatalogSha256: '2'.repeat(64),
    corpus: {
      root: '/tmp/corpus',
      lockSha256: '7fa467c8260cd6f488c4121b5b33fa75895474199a03f9888b5820cd52eb3eba',
      atomicCatalogSha256: '03c572d248ccfe1b7398c0f1f80b6ae57f39dec5913aa518cb4d079700a0fb4b',
    },
    cells: orders.flatMap((order, block) => order.map((name, localPosition) => ({
      id: `C${String(block * 3 + localPosition + 1).padStart(2, '0')}`,
      taskId: tasks[block % 2], mode: 'atomic' as const, dependencies: [],
      treatment: { path: `/tmp/${name}`, sha256: digest(name), sourceRoot: '/tmp/source',
        profile: tasks[block % 2].startsWith('H01') ? 'bounded-defect-repair' : 'brownfield-ownership', platform: 'test' },
      timeoutSeconds: 1, order: { repetition: Math.floor(block / 2), position: block * 3 + localPosition },
    }))), cumulativeJourneys: [],
  };
}

async function analysisPolicy(ceiling: number | null): Promise<CalibrationAnalysisPolicy> {
  const value = JSON.parse(await readFile(path.join(repositoryRoot, 'benchmark/calibration/e13/analysis-policy.json'), 'utf8'));
  value.approvedHumanCreditCeiling = ceiling;
  return value as CalibrationAnalysisPolicy;
}

function observationsFixture(): BlindedCalibrationObservation[] {
  const orders = [['A','B','C'],['A','C','B'],['B','C','A'],['C','B','A'],['C','A','B'],['B','A','C']];
  return orders.flatMap((order, block) => order.map((opaqueTreatment, position) => {
    const offset = block * 3 + position;
    return {
      taskId: block % 2 === 0 ? 'H01-config-precedence' : 'H02-brownfield-script-merge',
      blockId: `B${String(block + 1).padStart(2, '0')}`, position: position as 0 | 1 | 2, opaqueTreatment,
      outcomes: { correctness: known(offset % 4 === 0 ? 0.5 : 1), proof: known(offset % 5 === 0 ? 0 : 1) },
      telemetry: telemetry(100 + offset * 3, 200 + offset * 7, offset % 3, 2 + offset / 10),
    };
  }));
}

function telemetry(input: number, wall: number, loops: number, credits: number) {
  return { inputTokens: known(input), cachedInputTokens: known(input / 10), outputTokens: known(input / 5),
    wallMilliseconds: known(wall), toolLoops: known(loops), consumedPlanCredits: known(credits),
    costUsd: { status: 'unknown' as const, reason: 'ChatGPT-plan mode has no per-cell USD price' } };
}

function known(value: number): KnownOrUnknown<number> { return { status: 'known', value }; }

async function temporary(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'us030-calibration-test-'));
  roots.push(root);
  return root;
}
