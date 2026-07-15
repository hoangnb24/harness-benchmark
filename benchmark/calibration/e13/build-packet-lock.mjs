#!/usr/bin/env node
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { canonicalJson, sha256 } from '../../phase0/corpus-lib.mjs';

const REPOSITORY = path.resolve(import.meta.dirname, '../../..');
const PACKET = path.resolve(import.meta.dirname);

export async function buildPacketLock() {
  const relativeFiles = [
    ...(await filesUnder('benchmark/calibration/e13', (relative) => relative !== 'benchmark/calibration/e13/packet-lock.json')),
    'benchmark/candidates/e13/materialize-candidate.mjs',
    ...(await filesUnder('benchmark/orchestrator', (relative) => relative.endsWith('.ts'))),
    'benchmark/phase0/corpus-lib.mjs',
    'benchmark/phase0/rubric-runner.mjs',
    'package-lock.json',
  ].sort();
  const identities = [];
  for (const relative of relativeFiles) {
    identities.push({ path: relative, sha256: sha256(await readFile(path.join(REPOSITORY, relative))) });
  }
  return {
    schemaVersion: 1,
    packetId: 'e13-gate-d0-held-out-v4',
    state: 'approval-ready-offline-template',
    runner: {
      repository: 'harness-benchmark',
      qualifiedBaseCommit: '2013dd55bac4c4bbc5bd9eff950eeb6f24d999ef',
      executionCommit: {
        state: 'supplied-by-cycle-free-governance-after-this-packet-is-committed'
      }
    },
    scope: {
      calibrationOnly: true,
      decisionCorpusEligible: false,
      decisionAggregateEligible: false,
      liveExecutionAuthorized: false,
      us110Authorized: false,
      failFastAfterFirstInvalidCell: true,
      blindedSizingReportImplemented: true
    },
    outputRoot: 'benchmark/evaluation/calibration-runs/e13-gate-d0-calibration-v4',
    plannedCalls: 18,
    concurrency: 1,
    retries: 0,
    identities,
    candidateIdentityFile: 'benchmark/calibration/e13/candidate-identities.json',
    approvalTemplate: 'benchmark/calibration/e13/gate-d0-approval-template.json',
    futureDecisionCreditCeilingTemplate: 'benchmark/calibration/e13/future-decision-credit-ceiling-template.json',
    blindedReportTemplate: 'benchmark/calibration/e13/blinded-report-template.json'
  };
}

async function filesUnder(relativeRoot, include) {
  const files = [];
  async function walk(relativeDirectory) {
    const entries = await readdir(path.join(REPOSITORY, relativeDirectory), { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const relative = path.posix.join(relativeDirectory, entry.name);
      if (entry.isDirectory()) await walk(relative);
      else if (entry.isFile() && include(relative)) files.push(relative);
      else if (entry.isSymbolicLink()) throw new Error(`packet input is a symbolic link: ${relative}`);
    }
  }
  await walk(relativeRoot);
  return files;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const output = `${JSON.stringify(await buildPacketLock(), null, 2)}\n`;
  if (process.argv.includes('--write')) await writeFile(path.join(PACKET, 'packet-lock.json'), output);
  else process.stdout.write(output);
}
