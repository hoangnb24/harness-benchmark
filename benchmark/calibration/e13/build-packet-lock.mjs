#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { canonicalJson, sha256 } from '../../phase0/corpus-lib.mjs';

const REPOSITORY = path.resolve(import.meta.dirname, '../../..');
const PACKET = path.resolve(import.meta.dirname);
const relativeFiles = [
  'benchmark/calibration/e13/analysis-policy.json',
  'benchmark/calibration/e13/blinded-report-template.json',
  'benchmark/calibration/e13/build-packet-lock.mjs',
  'benchmark/calibration/e13/candidate-identities.json',
  'benchmark/calibration/e13/corpus/atomic-catalog.json',
  'benchmark/calibration/e13/corpus/build-lock.mjs',
  'benchmark/calibration/e13/corpus/calibration-lib.mjs',
  'benchmark/calibration/e13/corpus/corpus-lock.json',
  'benchmark/calibration/e13/corpus/materialize-fixture.mjs',
  'benchmark/calibration/e13/corpus/rubric-runner.mjs',
  'benchmark/calibration/e13/execution-contract-template.json',
  'benchmark/calibration/e13/gate-d0-approval-template.json',
  'benchmark/calibration/e13/schedule.json',
  'benchmark/calibration/e13/verify-packet.mjs',
  'benchmark/candidates/e13/materialize-candidate.mjs',
  'benchmark/orchestrator/application/GenerateCalibrationAggregate.ts',
  'benchmark/orchestrator/application/GenerateCalibrationAnalysis.ts',
  'benchmark/orchestrator/domain/calibration.ts',
  'benchmark/orchestrator/interface/evaluation-cli.ts',
  'benchmark/orchestrator/test/held-out-calibration-packet.test.ts',
  'benchmark/phase0/corpus-lib.mjs',
  'benchmark/phase0/rubric-runner.mjs',
  'package-lock.json'
];

export async function buildPacketLock() {
  const identities = [];
  for (const relative of relativeFiles) {
    identities.push({ path: relative, sha256: sha256(await readFile(path.join(REPOSITORY, relative))) });
  }
  return {
    schemaVersion: 1,
    packetId: 'e13-gate-d0-held-out-v1',
    state: 'approval-ready-offline-template',
    runner: {
      repository: 'harness-benchmark',
      us029Commit: '2013dd55bac4c4bbc5bd9eff950eeb6f24d999ef'
    },
    scope: {
      calibrationOnly: true,
      decisionCorpusEligible: false,
      decisionAggregateEligible: false,
      liveExecutionAuthorized: false,
      us110Authorized: false
    },
    outputRoot: 'benchmark/evaluation/calibration-runs/e13-gate-d0-calibration-v1',
    plannedCalls: 18,
    concurrency: 1,
    retries: 0,
    identities,
    candidateIdentityFile: 'benchmark/calibration/e13/candidate-identities.json',
    approvalTemplate: 'benchmark/calibration/e13/gate-d0-approval-template.json',
    blindedReportTemplate: 'benchmark/calibration/e13/blinded-report-template.json'
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.stdout.write(`${JSON.stringify(await buildPacketLock(), null, 2)}\n`);
}
