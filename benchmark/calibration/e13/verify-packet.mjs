#!/usr/bin/env node
import { execFile as execFileCallback } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { canonicalJson, sha256 } from '../../phase0/corpus-lib.mjs';
import { buildPacketLock } from './build-packet-lock.mjs';
import { buildCalibrationCorpusLock } from './corpus/build-lock.mjs';
import { materializeCalibrationFixture } from './corpus/materialize-fixture.mjs';
import { loadCalibrationCorpus } from './corpus/calibration-lib.mjs';

const ROOT = path.resolve(import.meta.dirname, '../../..');
const PACKET = path.resolve(import.meta.dirname);
const execFile = promisify(execFileCallback);

export async function verifyPacket({ sourceRoot }) {
  const actualLock = JSON.parse(await readFile(path.join(PACKET, 'packet-lock.json'), 'utf8'));
  const expectedLock = await buildPacketLock();
  assertPacketLock(actualLock, expectedLock);
  const corpusLock = JSON.parse(await readFile(path.join(PACKET, 'corpus/corpus-lock.json'), 'utf8'));
  assertCorpusLock(corpusLock, await buildCalibrationCorpusLock());
  const schedule = JSON.parse(await readFile(path.join(PACKET, 'schedule.json'), 'utf8'));
  assertExactSchedule(schedule);
  const policy = JSON.parse(await readFile(path.join(PACKET, 'analysis-policy.json'), 'utf8'));
  assertPolicy(policy);
  const approval = JSON.parse(await readFile(path.join(PACKET, 'gate-d0-approval-template.json'), 'utf8'));
  if (approval.state !== 'pending-human-approval' || approval.authorizesLiveExecution || approval.authorizesCalibration ||
    approval.authorizesUS110 || approval.approvedHumanCreditCeiling !== null) throw new Error('approval template grants authority or invents a human ceiling');
  await verifyCandidates(sourceRoot);
  const corpus = await loadCalibrationCorpus();
  for (const taskId of ['H01-config-precedence', 'H02-brownfield-script-merge']) {
    const root = await mkdtemp(path.join(tmpdir(), `verify-${taskId}-`));
    try {
      const receipt = path.join(root, 'receipt.json');
      const workspace = path.join(root, 'workspace');
      const record = await materializeCalibrationFixture({ corpus, taskId, workspace, output: workspace, receipt });
      if (taskId === 'H02-brownfield-script-merge' &&
        record.dirtyBaseline.status.join('\0') !== '?? LOCAL_PATCH.md') throw new Error('H02 correct dirty baseline is absent');
    } finally { await rm(root, { recursive: true, force: true }); }
  }
  return { packetId: actualLock.packetId, packetLockSha256: sha256(await readFile(path.join(PACKET, 'packet-lock.json'))),
    status: 'offline-packet-verified', liveProviderCalls: 0 };
}

export function assertPacketLock(actual, expected) {
  if (canonicalJson(actual) !== canonicalJson(expected)) throw new Error('packet lock or implementation identity mismatch');
}

export function assertCorpusLock(actual, expected) {
  if (canonicalJson(actual) !== canonicalJson(expected)) throw new Error('calibration corpus lock mismatch');
}

function assertExactSchedule(schedule) {
  const orders = ['FULL_V0,COPY_ONCE,MODULAR_CORE','FULL_V0,MODULAR_CORE,COPY_ONCE',
    'COPY_ONCE,MODULAR_CORE,FULL_V0','MODULAR_CORE,COPY_ONCE,FULL_V0',
    'MODULAR_CORE,FULL_V0,COPY_ONCE','COPY_ONCE,FULL_V0,MODULAR_CORE'];
  if (schedule.plannedCalls !== 18 || schedule.concurrency !== 1 || schedule.retries !== 0 ||
    schedule.blocks?.length !== 6 || schedule.calls?.length !== 18 ||
    schedule.blocks.some((block, index) => block.order.join(',') !== orders[index]) ||
    schedule.calls.some((call, index) => call.callId !== `C${String(index + 1).padStart(2, '0')}` ||
      call.blockId !== `B${String(Math.floor(index / 3) + 1).padStart(2, '0')}` || call.localPosition !== index % 3)) {
    throw new Error('calibration schedule is not the exact contiguous balanced 18-call schedule');
  }
}

function assertPolicy(policy) {
  const endpoints = policy.design?.endpoints ?? [];
  if (policy.approvedHumanCreditCeiling !== null || policy.design?.residualDegreesOfFreedom !== 4 ||
    policy.design?.balancedRepetitionMultiple !== 6 || policy.design?.planningCreditsPerInvocation?.value !== 40 ||
    policy.design?.planningCreditsPerInvocation?.classification !== 'published-average-range-upper-end-not-cap' ||
    endpoints.length !== 6 || endpoints.some((endpoint) => endpoint.varianceFloor <= 0 ||
      endpoint.decisionTaskCountK !== (endpoint.purpose === 'non-inferiority' ? 2 : 16)) ||
    endpoints.find((endpoint) => endpoint.id === 'inputTokens')?.planningBasis?.plannedValue >= 0.85) {
    throw new Error('calibration analysis policy is not the frozen blocker-safe design');
  }
}

async function verifyCandidates(sourceRoot) {
  if (!sourceRoot) throw new Error('--source-root is required for offline candidate identity verification');
  const identities = JSON.parse(await readFile(path.join(PACKET, 'candidate-identities.json'), 'utf8'));
  for (const treatment of identities.treatments) {
    const relative = `${identities.manifestRoot}/${treatment.file}`;
    const manifest = path.join(sourceRoot, relative);
    const committed = (await execFile(
      'git',
      ['show', `${identities.sourceCommit}:${relative}`],
      { cwd: sourceRoot, encoding: 'buffer', maxBuffer: 16 * 1024 * 1024 },
    )).stdout;
    if (sha256(committed) !== treatment.sha256 || sha256(await readFile(manifest)) !== treatment.sha256) {
      throw new Error(`candidate checksum mismatch: ${treatment.id}`);
    }
  }
}

function args(argv) { const output = {}; for (let i = 0; i < argv.length; i += 2) output[argv[i].slice(2)] = argv[i + 1]; return output; }
if (import.meta.url === `file://${process.argv[1]}`) {
  const options = args(process.argv.slice(2));
  verifyPacket({ sourceRoot: options['source-root'] && path.resolve(options['source-root']) })
    .then((result) => process.stdout.write(`${JSON.stringify(result)}\n`))
    .catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}
