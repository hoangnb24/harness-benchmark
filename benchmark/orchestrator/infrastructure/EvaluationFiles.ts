import { createHash } from 'node:crypto';
import { lstat, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

export function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

export async function sha256File(filePath: string): Promise<string> {
  return sha256(await readFile(filePath));
}

export function canonicalJson(value: unknown): string {
  return `${JSON.stringify(canonicalize(value), null, 2)}\n`;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalize(item)]),
    );
  }
  return value;
}

export async function listFiles(root: string, excludeGit = false): Promise<string[]> {
  const files: string[] = [];
  async function walk(directory: string, prefix: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      if (excludeGit && prefix === '' && entry.name === '.git') continue;
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      const absolute = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        throw new Error(`symbolic links are not allowed in evaluation trees: ${relative}`);
      }
      if (entry.isDirectory()) await walk(absolute, relative);
      else if (entry.isFile()) files.push(relative);
      else throw new Error(`unsupported entry in evaluation tree: ${relative}`);
    }
  }
  await walk(root, '');
  return files;
}

export async function treeSha256(root: string, excludeGit = false): Promise<string> {
  const rows: string[] = [];
  for (const relative of await listFiles(root, excludeGit)) {
    const absolute = path.join(root, relative);
    const stat = await lstat(absolute);
    if (!stat.isFile()) throw new Error(`evaluation tree entry is not a regular file: ${relative}`);
    const digest = sha256(await readFile(absolute));
    rows.push(`${digest} ${stat.mode & 0o777} ${relative}\n`);
  }
  return sha256(rows.join(''));
}

export function assertSha256(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) {
    throw new Error(`${label} must be a lowercase sha256`);
  }
}

export function assertNonEmpty(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${label} is required`);
}
