#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { execFile as execFileCallback } from 'node:child_process';
import { chmod, mkdir, readFile, readdir, rm, rmdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);

function fail(message) {
  throw new Error(message);
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  if (!['materialize', 'teardown'].includes(command)) {
    fail('usage: materialize-candidate.mjs <materialize|teardown> --manifest FILE --target DIR [--source-root DIR] [--profile ID] [--platform ID] [--receipt FILE] [--artifact-cache DIR]');
  }

  const options = { command };
  for (let index = 0; index < rest.length; index += 2) {
    const flag = rest[index];
    const value = rest[index + 1];
    if (!flag?.startsWith('--') || value === undefined) {
      fail(`invalid argument near ${flag ?? '<end>'}`);
    }
    options[flag.slice(2)] = value;
  }
  for (const required of ['manifest', 'target']) {
    if (!options[required]) fail(`missing --${required}`);
  }
  return options;
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function lineCount(buffer) {
  let count = 0;
  for (const byte of buffer) if (byte === 10) count += 1;
  return count;
}

function normalizedRelativePath(value) {
  if (!value || path.isAbsolute(value)) fail(`candidate path must be relative: ${value}`);
  const normalized = path.posix.normalize(value.replaceAll('\\', '/'));
  if (normalized === '..' || normalized.startsWith('../') || normalized.includes('/../')) {
    fail(`candidate path escapes target: ${value}`);
  }
  return normalized;
}

function resolveInside(root, relative) {
  const normalized = normalizedRelativePath(relative);
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, normalized);
  if (resolved !== resolvedRoot && !resolved.startsWith(`${resolvedRoot}${path.sep}`)) {
    fail(`resolved path escapes root: ${relative}`);
  }
  return resolved;
}

function defaultPlatform() {
  const key = `${process.platform}-${process.arch}`;
  const supported = {
    'darwin-arm64': 'macos-arm64',
    'darwin-x64': 'macos-x64',
    'linux-arm64': 'linux-arm64',
    'linux-x64': 'linux-x64',
    'win32-x64': 'windows-x64',
  };
  return supported[key] ?? fail(`unsupported host platform ${key}; pass --platform explicitly`);
}

async function loadManifest(manifestPath) {
  const bytes = await readFile(manifestPath);
  const manifest = JSON.parse(bytes.toString('utf8'));
  if (manifest.schemaVersion !== 1) fail(`unsupported candidate manifest schema: ${manifest.schemaVersion}`);
  if (!manifest.candidateId || !Array.isArray(manifest.files) || !Array.isArray(manifest.activationProfiles)) {
    fail('candidate manifest is missing required fields');
  }
  return { manifest, bytes, digest: sha256(bytes) };
}

function selectProfile(manifest, requested) {
  const id = requested ?? manifest.defaultActivationProfile;
  const profile = manifest.activationProfiles.find((candidate) => candidate.id === id);
  if (!profile) fail(`unknown activation profile ${id}`);
  const groups = new Set(profile.groups);
  const files = manifest.files.filter((entry) => groups.has(entry.group));
  const artifacts = (manifest.artifacts ?? []).filter((entry) => groups.has(entry.group));
  const seen = new Set();
  for (const entry of [...files, ...artifacts]) {
    const relative = normalizedRelativePath(entry.path);
    if (seen.has(relative)) fail(`duplicate selected output path: ${relative}`);
    seen.add(relative);
  }
  return { profile, files, artifacts };
}

async function listFiles(root) {
  const found = [];
  async function walk(directory, prefix) {
    let entries = [];
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (error.code === 'ENOENT') return;
      throw error;
    }
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(absolute, relative);
      else found.push(relative);
    }
  }
  await walk(root, '');
  return found;
}

async function assertEmptyTarget(target) {
  const existing = await listFiles(target);
  if (existing.length > 0) fail(`target must be empty before materialization; found ${existing.join(', ')}`);
}

async function sourceBytes(entry, sourceRoot, cacheRoot) {
  if (entry.source.type === 'inline') return Buffer.from(entry.source.contentUtf8, 'utf8');
  if (entry.source.type === 'repository') {
    if (!sourceRoot) fail(`--source-root is required for ${entry.path}`);
    if (!entry.source.commit) fail(`repository source commit missing for ${entry.path}`);
    normalizedRelativePath(entry.source.path);
    const cachePath = cacheRoot ? resolveInside(cacheRoot, `source-${entry.sha256}`) : undefined;
    if (cachePath) {
      try {
        const cached = await readFile(cachePath);
        if (sha256(cached) === entry.sha256) return cached;
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
    const { stdout } = await execFile(
      'git',
      ['show', `${entry.source.commit}:${entry.source.path}`],
      { cwd: sourceRoot, encoding: 'buffer', maxBuffer: 16 * 1024 * 1024 },
    );
    const bytes = Buffer.from(stdout);
    if (sha256(bytes) !== entry.sha256) fail(`source commit checksum mismatch for ${entry.path}`);
    if (cachePath) {
      await mkdir(path.dirname(cachePath), { recursive: true });
      await writeFile(cachePath, bytes);
    }
    return bytes;
  }
  fail(`unsupported file source type ${entry.source.type} for ${entry.path}`);
}

function verifyDeclaredFile(entry, bytes) {
  const digest = sha256(bytes);
  if (digest !== entry.sha256) fail(`checksum mismatch for ${entry.path}: expected ${entry.sha256}, got ${digest}`);
  if (bytes.length !== entry.bytes) fail(`byte count mismatch for ${entry.path}: expected ${entry.bytes}, got ${bytes.length}`);
  const lines = lineCount(bytes);
  if (lines !== entry.lines) fail(`line count mismatch for ${entry.path}: expected ${entry.lines}, got ${lines}`);
  return digest;
}

async function downloadArtifact(platformSpec, cacheRoot) {
  const cachePath = cacheRoot ? resolveInside(cacheRoot, platformSpec.sha256) : undefined;
  if (cachePath) {
    try {
      const cached = await readFile(cachePath);
      if (sha256(cached) === platformSpec.sha256) return cached;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }

  const response = await fetch(platformSpec.url, { redirect: 'follow' });
  if (!response.ok) fail(`artifact download failed (${response.status}) for ${platformSpec.url}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const digest = sha256(bytes);
  if (digest !== platformSpec.sha256) {
    fail(`artifact checksum mismatch for ${platformSpec.url}: expected ${platformSpec.sha256}, got ${digest}`);
  }
  if (bytes.length !== platformSpec.bytes) {
    fail(`artifact byte count mismatch for ${platformSpec.url}: expected ${platformSpec.bytes}, got ${bytes.length}`);
  }
  if (cachePath) {
    await mkdir(path.dirname(cachePath), { recursive: true });
    await writeFile(cachePath, bytes);
  }
  return bytes;
}

async function materialize(options, loaded) {
  const { manifest, digest } = loaded;
  const target = path.resolve(options.target);
  const sourceRoot = options['source-root'] ? path.resolve(options['source-root']) : undefined;
  const platform = options.platform ?? defaultPlatform();
  const selected = selectProfile(manifest, options.profile);
  await mkdir(target, { recursive: true });
  await assertEmptyTarget(target);

  const receiptFiles = [];
  for (const entry of selected.files) {
    const bytes = await sourceBytes(entry, sourceRoot, options['artifact-cache']);
    const fileDigest = verifyDeclaredFile(entry, bytes);
    const output = resolveInside(target, entry.path);
    await mkdir(path.dirname(output), { recursive: true });
    await writeFile(output, bytes);
    await chmod(output, Number.parseInt(entry.mode, 8));
    receiptFiles.push({
      path: normalizedRelativePath(entry.path),
      sha256: fileDigest,
      bytes: bytes.length,
      lines: lineCount(bytes),
      mode: entry.mode,
      sourceType: entry.source.type,
    });
  }

  for (const artifact of selected.artifacts) {
    const platformSpec = artifact.platforms[platform];
    if (!platformSpec) fail(`artifact ${artifact.path} does not support platform ${platform}`);
    const bytes = await downloadArtifact(platformSpec, options['artifact-cache']);
    const outputPath = platform === 'windows-x64' && artifact.windowsPath ? artifact.windowsPath : artifact.path;
    const output = resolveInside(target, outputPath);
    await mkdir(path.dirname(output), { recursive: true });
    await writeFile(output, bytes);
    await chmod(output, Number.parseInt(artifact.mode, 8));
    receiptFiles.push({
      path: normalizedRelativePath(outputPath),
      sha256: platformSpec.sha256,
      bytes: bytes.length,
      lines: null,
      mode: artifact.mode,
      sourceType: 'release-artifact',
    });
  }

  receiptFiles.sort((left, right) => left.path.localeCompare(right.path));
  const treeInput = receiptFiles.map((entry) => `${entry.sha256}  ${entry.path}\n`).join('');
  const receipt = {
    schemaVersion: 1,
    operation: 'materialize',
    candidateId: manifest.candidateId,
    activationProfile: selected.profile.id,
    taskClasses: selected.profile.taskClasses,
    platform,
    manifestSha256: digest,
    treeSha256: sha256(Buffer.from(treeInput, 'utf8')),
    totals: {
      files: receiptFiles.length,
      bytes: receiptFiles.reduce((sum, entry) => sum + entry.bytes, 0),
      lines: receiptFiles.reduce((sum, entry) => sum + (entry.lines ?? 0), 0),
    },
    files: receiptFiles,
  };
  if (options.receipt) await writeFile(options.receipt, `${JSON.stringify(receipt, null, 2)}\n`);
  else process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
}

async function teardown(options, loaded) {
  const { manifest, digest } = loaded;
  const target = path.resolve(options.target);
  const platform = options.platform ?? defaultPlatform();
  const selected = selectProfile(manifest, options.profile);
  const owned = selected.files.map((entry) => ({ path: entry.path, sha256: entry.sha256 }));
  for (const artifact of selected.artifacts) {
    const platformSpec = artifact.platforms[platform];
    if (!platformSpec) fail(`artifact ${artifact.path} does not support platform ${platform}`);
    owned.push({
      path: platform === 'windows-x64' && artifact.windowsPath ? artifact.windowsPath : artifact.path,
      sha256: platformSpec.sha256,
    });
  }

  const orderedOwned = owned.sort((left, right) => right.path.length - left.path.length);
  for (const entry of orderedOwned) {
    const output = resolveInside(target, entry.path);
    let bytes;
    try {
      bytes = await readFile(output);
    } catch (error) {
      if (error.code === 'ENOENT') fail(`owned path missing during teardown: ${entry.path}`);
      throw error;
    }
    const digestActual = sha256(bytes);
    if (digestActual !== entry.sha256) {
      fail(`refusing to remove modified owned path ${entry.path}: expected ${entry.sha256}, got ${digestActual}`);
    }
  }
  for (const entry of orderedOwned) {
    const output = resolveInside(target, entry.path);
    await rm(output);
  }

  const directories = new Set();
  for (const entry of owned) {
    let current = path.posix.dirname(normalizedRelativePath(entry.path));
    while (current && current !== '.') {
      directories.add(current);
      current = path.posix.dirname(current);
    }
  }
  for (const directory of [...directories].sort((left, right) => right.length - left.length)) {
    try {
      await rmdir(resolveInside(target, directory));
    } catch (error) {
      if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(error.code)) throw error;
    }
  }

  const remainingPaths = await listFiles(target);
  if (remainingPaths.length > 0) fail(`teardown left unowned paths: ${remainingPaths.join(', ')}`);
  const receipt = {
    schemaVersion: 1,
    operation: 'teardown',
    candidateId: manifest.candidateId,
    activationProfile: selected.profile.id,
    platform,
    manifestSha256: digest,
    removedFiles: owned.length,
    remainingPaths,
  };
  if (options.receipt) await writeFile(options.receipt, `${JSON.stringify(receipt, null, 2)}\n`);
  else process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
}

const options = parseArgs(process.argv.slice(2));
const loaded = await loadManifest(options.manifest);
if (options.command === 'materialize') await materialize(options, loaded);
else await teardown(options, loaded);
