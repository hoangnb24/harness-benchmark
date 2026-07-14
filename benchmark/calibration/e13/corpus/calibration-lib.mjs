import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { canonicalJson, componentIdentities, sha256 } from '../../../phase0/corpus-lib.mjs';

export const ROOT = path.resolve(import.meta.dirname);

export async function loadCalibrationCorpus() {
  const catalogPath = path.join(ROOT, 'atomic-catalog.json');
  const lockPath = path.join(ROOT, 'corpus-lock.json');
  return {
    atomic: JSON.parse(await readFile(catalogPath, 'utf8')),
    lock: JSON.parse(await readFile(lockPath, 'utf8')),
    paths: { catalogPath, lockPath },
  };
}

export function findCalibrationTask(corpus, taskId) {
  const task = corpus.atomic.tasks.find((item) => item.id === taskId);
  if (!task) throw new Error(`missing held-out calibration task: ${taskId}`);
  return task;
}

export function assertFrozenCalibrationTask(corpus, task) {
  const frozen = corpus.lock.atomicTasks.find((item) => item.id === task.id);
  if (!frozen) throw new Error(`missing held-out frozen identity: ${task.id}`);
  const actual = componentIdentities(task);
  for (const key of ['fixtureSha256', 'promptSha256', 'rubricSha256']) {
    if (actual[key] !== frozen[key]) throw new Error(`${task.id} ${key} differs from calibration lock`);
  }
  return frozen;
}

export { canonicalJson, sha256 };
