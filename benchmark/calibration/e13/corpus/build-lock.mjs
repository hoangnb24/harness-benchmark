#!/usr/bin/env node
import { execFile as execFileCallback } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { componentIdentities, canonicalJson, directoryIdentity, sha256, writeFileMap } from '../../../phase0/corpus-lib.mjs';

const execFile = promisify(execFileCallback);
const ROOT = path.resolve(import.meta.dirname);
const GIT_ENV = {
  PATH: process.env.PATH, LANG: 'C', LC_ALL: 'C', GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null',
  GIT_AUTHOR_NAME: 'Held-Out Calibration Fixture', GIT_AUTHOR_EMAIL: 'heldout-calibration@example.invalid',
  GIT_AUTHOR_DATE: '2026-07-14T00:00:00Z', GIT_COMMITTER_NAME: 'Held-Out Calibration Fixture',
  GIT_COMMITTER_EMAIL: 'heldout-calibration@example.invalid', GIT_COMMITTER_DATE: '2026-07-14T00:00:00Z'
};

export async function buildCalibrationCorpusLock() {
  const catalog = JSON.parse(await readFile(path.join(ROOT, 'atomic-catalog.json'), 'utf8'));
  const atomicTasks = [];
  for (const task of catalog.tasks) {
    const temporary = await mkdtemp(path.join(tmpdir(), `calibration-lock-${task.id}-`));
    try {
      const dirty = new Set(task.fixture.dirtyFiles);
      await writeFileMap(temporary, Object.fromEntries(Object.entries(task.fixture.files).filter(([name]) => !dirty.has(name))));
      const git = (args) => execFile('git', ['-c', `core.hooksPath=${process.platform === 'win32' ? 'NUL' : '/dev/null'}`, '-c', 'commit.gpgSign=false', ...args], { cwd: temporary, env: GIT_ENV });
      await git(['init', '--quiet']);
      await git(['add', '--all']);
      await git(['commit', '--quiet', '--message', `fixture: ${task.fixture.seedId}`]);
      const startCommit = (await execFile('git', ['rev-parse', 'HEAD'], { cwd: temporary, encoding: 'utf8' })).stdout.trim();
      await writeFileMap(temporary, Object.fromEntries(Object.entries(task.fixture.files).filter(([name]) => dirty.has(name))));
      const identity = await directoryIdentity(temporary);
      atomicTasks.push({ id: task.id, ...componentIdentities(task), startCommit,
        materializedTreeSha256: identity.sha256, dirtyFiles: [...dirty].sort() });
    } finally { await rm(temporary, { recursive: true, force: true }); }
  }
  return {
    schemaVersion: 1,
    corpusId: catalog.corpusId,
    scope: 'held-out-calibration-only',
    decisionCorpusEligible: false,
    atomicCatalogSha256: sha256(canonicalJson(catalog)),
    atomicTasks,
    implementationIdentities: {
      materializeFixtureSha256: sha256(await readFile(path.join(ROOT, 'materialize-fixture.mjs'))),
      rubricRunnerSha256: sha256(await readFile(path.join(ROOT, 'rubric-runner.mjs')))
    }
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const output = `${JSON.stringify(await buildCalibrationCorpusLock(), null, 2)}\n`;
  if (process.argv.includes('--write')) await writeFile(path.join(ROOT, 'corpus-lock.json'), output);
  else process.stdout.write(output);
}
