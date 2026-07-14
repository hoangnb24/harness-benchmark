#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import { execFile as execFileCallback } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import {
  assertEmptyDestination,
  assertFrozenTask,
  canonicalJson,
  directoryIdentity,
  findAtomicTask,
  loadCorpus,
  sha256,
  writeFileMap,
} from './corpus-lib.mjs';

const execFile = promisify(execFileCallback);
const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 'Phase 0 Fixture',
  GIT_AUTHOR_EMAIL: 'phase0-fixture@example.invalid',
  GIT_AUTHOR_DATE: '2026-07-14T00:00:00Z',
  GIT_COMMITTER_NAME: 'Phase 0 Fixture',
  GIT_COMMITTER_EMAIL: 'phase0-fixture@example.invalid',
  GIT_COMMITTER_DATE: '2026-07-14T00:00:00Z',
};

export async function initializeStartCommit(output, seedId) {
  await execFile('git', ['init', '--quiet'], { cwd: output });
  await execFile('git', ['add', '--all'], { cwd: output });
  await execFile('git', ['commit', '--quiet', '--message', `fixture: ${seedId}`], {
    cwd: output,
    env: GIT_ENV,
  });
  const { stdout: commit } = await execFile('git', ['rev-parse', 'HEAD'], {
    cwd: output,
    encoding: 'utf8',
  });
  const { stdout: parents } = await execFile(
    'git',
    ['rev-list', '--parents', '--max-count=1', 'HEAD'],
    { cwd: output, encoding: 'utf8' },
  );
  if (parents.trim().split(/\s+/).length !== 1) {
    throw new Error(`${seedId} start commit unexpectedly has a parent`);
  }
  return commit.trim();
}

export async function materializeAtomicFixture({ corpus, taskId, output, receipt }) {
  const task = findAtomicTask(corpus, taskId);
  const locked = assertFrozenTask(corpus, task);
  if (task.dependencies.length !== 0 || task.fixture.lineage !== 'independent') {
    throw new Error(`${taskId} is not an independently seeded atomic task`);
  }
  await assertEmptyDestination(output);
  await mkdir(output, { recursive: true });
  await writeFileMap(output, task.fixture.files);
  const identity = await directoryIdentity(output);
  const expectedTree = sha256(canonicalJson({
    files: Object.fromEntries(
      Object.entries(task.fixture.files).map(([name, content]) => [name, sha256(content)]),
    ),
  }));
  if (identity.sha256 !== expectedTree) {
    throw new Error(`${taskId} materialized tree differs from frozen seed`);
  }
  const startCommit = await initializeStartCommit(output, task.fixture.seedId);
  if (locked.startCommit !== startCommit) {
    throw new Error(`${taskId} start commit does not match corpus lock`);
  }
  const record = {
    schemaVersion: 1,
    taskId,
    seedId: task.fixture.seedId,
    fixtureSha256: locked.fixtureSha256,
    startCommit,
    materializedTreeSha256: identity.sha256,
    files: identity.files,
  };
  await mkdir(path.dirname(receipt), { recursive: true });
  await writeFile(receipt, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  return record;
}

function args(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith('--') || value === undefined) throw new Error('expected --key value');
    result[key.slice(2)] = value;
  }
  return result;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const options = args(process.argv.slice(2));
  if (!options.task || !options.output || !options.receipt) {
    throw new Error('usage: materialize-fixture.mjs --task ID --output DIR --receipt FILE');
  }
  const corpus = await loadCorpus();
  const result = await materializeAtomicFixture({
    corpus,
    taskId: options.task,
    output: path.resolve(options.output),
    receipt: path.resolve(options.receipt),
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}
