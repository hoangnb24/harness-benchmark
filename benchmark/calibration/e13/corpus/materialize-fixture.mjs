#!/usr/bin/env node
import { execFile as execFileCallback } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { assertEmptyDestination, directoryIdentity, writeFileMap } from '../../../phase0/corpus-lib.mjs';
import { assertFrozenCalibrationTask, canonicalJson, findCalibrationTask, loadCalibrationCorpus, sha256 } from './calibration-lib.mjs';

const execFile = promisify(execFileCallback);
const GIT_ENV = {
  PATH: process.env.PATH,
  LANG: 'C',
  LC_ALL: 'C',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null',
  GIT_AUTHOR_NAME: 'Held-Out Calibration Fixture',
  GIT_AUTHOR_EMAIL: 'heldout-calibration@example.invalid',
  GIT_AUTHOR_DATE: '2026-07-14T00:00:00Z',
  GIT_COMMITTER_NAME: 'Held-Out Calibration Fixture',
  GIT_COMMITTER_EMAIL: 'heldout-calibration@example.invalid',
  GIT_COMMITTER_DATE: '2026-07-14T00:00:00Z'
};

export async function materializeCalibrationFixture({ corpus, taskId, output, receipt }) {
  const task = findCalibrationTask(corpus, taskId);
  const frozen = assertFrozenCalibrationTask(corpus, task);
  await assertEmptyDestination(output);
  await mkdir(output, { recursive: true });
  const dirty = new Set(task.fixture.dirtyFiles);
  const tracked = Object.fromEntries(Object.entries(task.fixture.files).filter(([name]) => !dirty.has(name)));
  await writeFileMap(output, tracked);
  const git = (args) => execFile('git', ['-c', `core.hooksPath=${process.platform === 'win32' ? 'NUL' : '/dev/null'}`, '-c', 'commit.gpgSign=false', ...args], { cwd: output, env: GIT_ENV });
  await git(['init', '--quiet']);
  await git(['add', '--all']);
  await git(['commit', '--quiet', '--message', `fixture: ${task.fixture.seedId}`]);
  const { stdout: commit } = await execFile('git', ['rev-parse', 'HEAD'], { cwd: output, encoding: 'utf8' });
  await writeFileMap(output, Object.fromEntries(Object.entries(task.fixture.files).filter(([name]) => dirty.has(name))));
  const identity = await directoryIdentity(output);
  const status = (await execFile('git', ['status', '--short'], { cwd: output, encoding: 'utf8' })).stdout.trim().split('\n').filter(Boolean);
  const expectedStatus = [...dirty].sort().map((name) => `?? ${name}`);
  if (status.join('\0') !== expectedStatus.join('\0')) throw new Error(`${taskId} dirty baseline differs from lock contract`);
  if (commit.trim() !== frozen.startCommit || identity.sha256 !== frozen.materializedTreeSha256) {
    throw new Error(`${taskId} materialized identity differs from calibration lock`);
  }
  const record = {
    schemaVersion: 1,
    taskId,
    seedId: task.fixture.seedId,
    fixtureSha256: frozen.fixtureSha256,
    startCommit: commit.trim(),
    materializedTreeSha256: identity.sha256,
    files: identity.files,
    dirtyBaseline: { correctBeforeTreatment: true, status }
  };
  await mkdir(path.dirname(receipt), { recursive: true });
  await writeFile(receipt, `${JSON.stringify(record, null, 2)}\n`);
  return record;
}

function args(argv) {
  const output = {};
  for (let index = 0; index < argv.length; index += 2) output[argv[index].slice(2)] = argv[index + 1];
  return output;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const options = args(process.argv.slice(2));
  const record = await materializeCalibrationFixture({
    corpus: await loadCalibrationCorpus(), taskId: options.task,
    output: path.resolve(options.output), receipt: path.resolve(options.receipt)
  });
  process.stdout.write(`${JSON.stringify(record)}\n`);
}
