import { createHash } from 'node:crypto';
import { access, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const ROOT = path.resolve(import.meta.dirname, '../..');
export const PHASE0 = path.resolve(import.meta.dirname);

export async function readJson(file) {
  return JSON.parse(await readFile(file, 'utf8'));
}

export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function componentIdentities(task) {
  return {
    fixtureSha256: sha256(canonicalJson(task.fixture)),
    promptSha256: sha256(task.prompt),
    rubricSha256: sha256(canonicalJson(task.rubric)),
  };
}

export async function pathExists(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

export async function directoryEntries(root) {
  if (!(await pathExists(root))) return [];
  const output = [];
  async function visit(current, prefix) {
    for (const name of (await readdir(current)).sort()) {
      if (!prefix && name === '.git') continue;
      const absolute = path.join(current, name);
      const relative = prefix ? `${prefix}/${name}` : name;
      const info = await stat(absolute);
      if (info.isDirectory()) await visit(absolute, relative);
      else if (info.isFile()) output.push(relative);
      else throw new Error(`unsupported fixture entry: ${relative}`);
    }
  }
  await visit(root, '');
  return output;
}

export async function directoryIdentity(root) {
  const files = {};
  for (const relative of await directoryEntries(root)) {
    files[relative] = sha256(await readFile(path.join(root, relative)));
  }
  return { files, sha256: sha256(canonicalJson({ files })) };
}

export async function assertEmptyDestination(output) {
  if (!(await pathExists(output))) return;
  const entries = await readdir(output);
  if (entries.length > 0) throw new Error(`fixture destination is not empty: ${output}`);
}

export async function writeFileMap(root, files) {
  for (const [relative, content] of Object.entries(files)) {
    if (path.isAbsolute(relative) || relative.split('/').includes('..')) {
      throw new Error(`unsafe fixture path: ${relative}`);
    }
    const target = path.join(root, relative);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content, 'utf8');
  }
}

export async function loadCorpus() {
  const atomicPath = path.join(PHASE0, 'atomic-catalog.json');
  const cumulativePath = path.join(PHASE0, 'cumulative-catalog.json');
  const lockPath = path.join(PHASE0, 'corpus-lock.json');
  return {
    atomic: await readJson(atomicPath),
    cumulative: await readJson(cumulativePath),
    lock: await readJson(lockPath),
    paths: { atomicPath, cumulativePath, lockPath },
  };
}

export function findAtomicTask(corpus, taskId) {
  const task = corpus.atomic.tasks.find((item) => item.id === taskId);
  if (!task) throw new Error(`missing atomic task or rubric: ${taskId}`);
  return task;
}

export function lockForTask(corpus, taskId) {
  const locked = corpus.lock.atomicTasks.find((item) => item.id === taskId);
  if (!locked) throw new Error(`missing frozen task identity: ${taskId}`);
  return locked;
}

export function assertFrozenTask(corpus, task) {
  const actual = componentIdentities(task);
  const locked = lockForTask(corpus, task.id);
  for (const key of ['fixtureSha256', 'promptSha256', 'rubricSha256']) {
    if (actual[key] !== locked[key]) {
      throw new Error(`${task.id} ${key} does not match corpus lock`);
    }
  }
  return locked;
}
