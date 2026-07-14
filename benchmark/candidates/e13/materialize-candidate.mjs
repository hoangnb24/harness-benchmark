#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { execFile as execFileCallback } from 'node:child_process';
import { chmod, lstat, mkdir, readFile, readdir, rm, rmdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);

function fail(message) {
  throw new Error(message);
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  if (!['materialize', 'apply', 'teardown'].includes(command)) {
    fail('usage: materialize-candidate.mjs <materialize|apply|teardown> --manifest FILE --target DIR [--source-root DIR] [--staged DIR] [--materialization-receipt FILE] [--profile ID] [--platform ID] [--receipt FILE] [--artifact-cache DIR]');
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
  if (command === 'apply') {
    for (const required of ['staged', 'materialization-receipt', 'receipt']) {
      if (!options[required]) fail(`missing --${required}`);
    }
  }
  return options;
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function sortJson(value) {
  if (Array.isArray(value)) return value.map(sortJson);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortJson(value[key])]));
  }
  return value;
}

function canonicalJson(value) {
  return `${JSON.stringify(sortJson(value), null, 2)}\n`;
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

function assertNotGitPath(value) {
  const normalized = normalizedRelativePath(value);
  if (normalized === '.git' || normalized.startsWith('.git/')) {
    fail(`application path may not access .git: ${value}`);
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
  const policy = manifest.applicationPolicy;
  if (!policy || policy.schemaVersion !== 1 || !Array.isArray(policy.pathRules)) {
    fail('candidate manifest is missing applicationPolicy schema version 1');
  }
  const policyDigest = sha256(Buffer.from(canonicalJson(policy), 'utf8'));
  if (manifest.applicationPolicySha256 !== policyDigest) {
    fail(`applicationPolicy checksum mismatch: expected ${manifest.applicationPolicySha256}, got ${policyDigest}`);
  }
  const actions = new Set(['create-if-absent', 'preserve-existing', 'append-marked-block', 'merge-lines']);
  if (!actions.has(policy.defaultAbsentAction) || policy.defaultAbsentAction !== 'create-if-absent') {
    fail('applicationPolicy defaultAbsentAction must be create-if-absent');
  }
  if (!actions.has(policy.defaultPresentAction) || !actions.has(policy.protectedCollisionAction)) {
    fail('applicationPolicy contains an unsupported default action');
  }
  const seenRules = new Set();
  for (const rule of policy.pathRules) {
    const relative = assertNotGitPath(rule.path);
    if (seenRules.has(relative)) fail(`duplicate applicationPolicy path rule: ${relative}`);
    seenRules.add(relative);
    if (!actions.has(rule.onAbsent) || !actions.has(rule.onPresent)) {
      fail(`unsupported application action for ${relative}`);
    }
    if (rule.onAbsent !== 'create-if-absent') {
      fail(`application rule onAbsent must be create-if-absent for ${relative}`);
    }
    if (rule.onPresent === 'append-marked-block') {
      const { begin, end } = rule.markers ?? {};
      if (!begin || !end || begin === end || begin.includes('\n') || end.includes('\n')) {
        fail(`invalid append markers for ${relative}`);
      }
    }
  }
  for (const relative of policy.protectedExactPaths ?? []) assertNotGitPath(relative);
  for (const prefix of policy.protectedPathPrefixes ?? []) assertNotGitPath(prefix);
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

async function listFiles(root, { excludeGit = false } = {}) {
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
      if (excludeGit && (relative === '.git' || relative.startsWith('.git/'))) continue;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(absolute, relative);
      else found.push(relative);
    }
  }
  await walk(root, '');
  return found;
}

async function maybeLstat(filePath) {
  try {
    return await lstat(filePath);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function assertSafePathComponents(root, relative, { leafMayBeMissing = true } = {}) {
  const normalized = assertNotGitPath(relative);
  const parts = normalized.split('/');
  let current = path.resolve(root);
  for (let index = 0; index < parts.length; index += 1) {
    current = path.join(current, parts[index]);
    const details = await maybeLstat(current);
    if (!details) {
      if (index === parts.length - 1 && !leafMayBeMissing) fail(`required path is missing: ${relative}`);
      continue;
    }
    if (details.isSymbolicLink()) fail(`symbolic links are not allowed in application paths: ${relative}`);
    if (index < parts.length - 1 && !details.isDirectory()) {
      fail(`application parent is not a directory: ${parts.slice(0, index + 1).join('/')}`);
    }
  }
}

async function treeSnapshot(root) {
  const files = await listFiles(root, { excludeGit: true });
  const entries = [];
  for (const relative of files) {
    assertNotGitPath(relative);
    await assertSafePathComponents(root, relative, { leafMayBeMissing: false });
    const bytes = await readFile(resolveInside(root, relative));
    entries.push({ path: relative, sha256: sha256(bytes), bytes: bytes.length });
  }
  entries.sort((left, right) => left.path.localeCompare(right.path));
  const treeInput = entries.map((entry) => `${entry.sha256}  ${entry.path}\n`).join('');
  return {
    sha256: sha256(Buffer.from(treeInput, 'utf8')),
    files: entries,
    totals: {
      files: entries.length,
      bytes: entries.reduce((sum, entry) => sum + entry.bytes, 0),
    },
  };
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

function modeString(details) {
  return (details.mode & 0o777).toString(8).padStart(4, '0');
}

function isProtectedPath(policy, relative) {
  if ((policy.protectedExactPaths ?? []).includes(relative)) return true;
  return (policy.protectedPathPrefixes ?? []).some((prefix) => (
    relative === prefix.replace(/\/$/, '') || relative.startsWith(prefix.endsWith('/') ? prefix : `${prefix}/`)
  ));
}

function containsMarker(bytes, marker) {
  return bytes.indexOf(Buffer.from(marker, 'utf8')) !== -1;
}

function appendMarkedBlock(original, staged, markers, relative) {
  if (containsMarker(original, markers.begin) || containsMarker(original, markers.end)) {
    fail(`marker collision in existing ${relative}`);
  }
  if (containsMarker(staged, markers.begin) || containsMarker(staged, markers.end)) {
    fail(`marker collision in staged ${relative}`);
  }
  const separator = original.length > 0 && original.at(-1) !== 10 ? Buffer.from('\n') : Buffer.alloc(0);
  const stagedSuffix = staged.length > 0 && staged.at(-1) !== 10 ? Buffer.from('\n') : Buffer.alloc(0);
  return Buffer.concat([
    original,
    separator,
    Buffer.from(`${markers.begin}\n`, 'utf8'),
    staged,
    stagedSuffix,
    Buffer.from(`${markers.end}\n`, 'utf8'),
  ]);
}

function decodeUtf8(bytes, relative) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    fail(`merge-lines requires UTF-8 content: ${relative}`);
  }
}

function mergeLines(original, staged, relative) {
  const originalText = decodeUtf8(original, relative);
  const stagedText = decodeUtf8(staged, relative);
  const seen = new Set(originalText.split(/\r?\n/));
  const additions = [];
  for (const line of stagedText.split(/\r?\n/)) {
    if (line.length === 0 || seen.has(line)) continue;
    seen.add(line);
    additions.push(line);
  }
  if (additions.length === 0) return original;
  const separator = original.length > 0 && original.at(-1) !== 10 ? '\n' : '';
  return Buffer.concat([original, Buffer.from(`${separator}${additions.join('\n')}\n`, 'utf8')]);
}

function pathIsInside(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

async function missingTargetDirectories(root, relative) {
  const directories = [];
  let current = path.posix.dirname(normalizedRelativePath(relative));
  while (current && current !== '.') {
    const absolute = resolveInside(root, current);
    if (!await maybeLstat(absolute)) directories.push(absolute);
    current = path.posix.dirname(current);
  }
  return directories;
}

async function missingAbsoluteDirectoryChain(directory) {
  const directories = [];
  let current = path.resolve(directory);
  while (true) {
    let details;
    try {
      details = await lstat(current);
    } catch (error) {
      if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error;
    }
    if (details) break;
    directories.push(current);
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return directories;
}

async function removeEmptyDirectories(directories) {
  const ordered = [...new Set(directories)].sort((left, right) => right.length - left.length);
  for (const directory of ordered) {
    try {
      await rmdir(directory);
    } catch (error) {
      if (!['ENOENT', 'ENOTDIR', 'ENOTEMPTY', 'EEXIST'].includes(error.code)) throw error;
    }
  }
}

async function removePartialReceipt(receiptPath) {
  try {
    await rm(receiptPath, { force: true });
  } catch (error) {
    if (!['ENOENT', 'ENOTDIR', 'EISDIR'].includes(error.code)) throw error;
  }
}

async function verifyStagedPayload(options, loaded, selected, platform) {
  const staged = path.resolve(options.staged);
  const stagedDetails = await maybeLstat(staged);
  if (!stagedDetails?.isDirectory()) fail('--staged must name a materialized directory');
  if (await maybeLstat(path.join(staged, '.git'))) fail('staged payload may not contain .git');

  const receiptBytes = await readFile(options['materialization-receipt']);
  const receipt = JSON.parse(receiptBytes.toString('utf8'));
  if (receipt.schemaVersion !== 1 || receipt.operation !== 'materialize') {
    fail('materialization receipt has an unsupported operation or schema');
  }
  if (receipt.candidateId !== loaded.manifest.candidateId
      || receipt.activationProfile !== selected.profile.id
      || receipt.platform !== platform
      || receipt.manifestSha256 !== loaded.digest) {
    fail('materialization receipt does not match manifest, profile, or platform');
  }

  const expected = new Map();
  for (const entry of selected.files) {
    expected.set(assertNotGitPath(entry.path), {
      sha256: entry.sha256,
      bytes: entry.bytes,
      lines: entry.lines,
      mode: entry.mode,
    });
  }
  for (const artifact of selected.artifacts) {
    const platformSpec = artifact.platforms[platform];
    if (!platformSpec) fail(`artifact ${artifact.path} does not support platform ${platform}`);
    const outputPath = platform === 'windows-x64' && artifact.windowsPath ? artifact.windowsPath : artifact.path;
    expected.set(assertNotGitPath(outputPath), {
      sha256: platformSpec.sha256,
      bytes: platformSpec.bytes,
      lines: null,
      mode: artifact.mode,
    });
  }

  if (!Array.isArray(receipt.files) || receipt.files.length !== expected.size) {
    fail('materialization receipt file count does not match selected manifest outputs');
  }
  const receiptByPath = new Map();
  for (const entry of receipt.files) {
    const relative = assertNotGitPath(entry.path);
    if (receiptByPath.has(relative)) fail(`duplicate materialization receipt path: ${relative}`);
    receiptByPath.set(relative, entry);
    const expectedEntry = expected.get(relative);
    if (!expectedEntry
        || entry.sha256 !== expectedEntry.sha256
        || entry.bytes !== expectedEntry.bytes
        || entry.lines !== expectedEntry.lines
        || entry.mode !== expectedEntry.mode) {
      fail(`materialization receipt path does not match manifest: ${relative}`);
    }
  }

  const stagedPaths = await listFiles(staged);
  for (const relative of stagedPaths) assertNotGitPath(relative);
  const expectedPaths = [...expected.keys()].sort((left, right) => left.localeCompare(right));
  const actualPaths = [...stagedPaths].sort((left, right) => left.localeCompare(right));
  if (JSON.stringify(actualPaths) !== JSON.stringify(expectedPaths)) {
    fail('staged payload contains missing or unexpected files');
  }

  const stagedFiles = [];
  for (const relative of actualPaths) {
    await assertSafePathComponents(staged, relative, { leafMayBeMissing: false });
    const output = resolveInside(staged, relative);
    const details = await lstat(output);
    if (!details.isFile()) fail(`staged output is not a regular file: ${relative}`);
    const bytes = await readFile(output);
    const expectedEntry = expected.get(relative);
    if (sha256(bytes) !== expectedEntry.sha256 || bytes.length !== expectedEntry.bytes) {
      fail(`staged payload differs from manifest: ${relative}`);
    }
    if (modeString(details) !== expectedEntry.mode) fail(`staged mode differs from manifest: ${relative}`);
    stagedFiles.push({
      path: relative,
      bytes,
      sha256: expectedEntry.sha256,
      mode: expectedEntry.mode,
    });
  }
  const treeInput = stagedFiles.map((entry) => `${entry.sha256}  ${entry.path}\n`).join('');
  const stagedTreeSha256 = sha256(Buffer.from(treeInput, 'utf8'));
  if (receipt.treeSha256 !== stagedTreeSha256) fail('materialization receipt tree checksum mismatch');
  return {
    receipt,
    receiptSha256: sha256(receiptBytes),
    files: stagedFiles,
    treeSha256: stagedTreeSha256,
  };
}

async function apply(options, loaded) {
  const { manifest, digest } = loaded;
  const target = path.resolve(options.target);
  const staged = path.resolve(options.staged);
  const receiptPath = path.resolve(options.receipt);
  const platform = options.platform ?? defaultPlatform();
  const selected = selectProfile(manifest, options.profile);
  if (pathIsInside(target, staged) || pathIsInside(staged, target)) {
    fail('staged payload and application target must be separate directories');
  }
  if (pathIsInside(target, receiptPath)) fail('application receipt must be outside the target tree');
  try {
    await lstat(receiptPath);
    fail('application receipt path already exists');
  } catch (error) {
    if (!['ENOENT', 'ENOTDIR'].includes(error.code)) throw error;
  }

  const targetDetails = await maybeLstat(target);
  if (!targetDetails?.isDirectory()) fail('application target must be an existing directory');
  const originalSnapshot = await treeSnapshot(target);
  if (originalSnapshot.totals.files === 0) fail('application target must be a nonempty fixture');

  const stagedProof = await verifyStagedPayload(options, loaded, selected, platform);
  const policy = manifest.applicationPolicy;
  const rules = new Map(policy.pathRules.map((rule) => [normalizedRelativePath(rule.path), rule]));
  const plan = [];

  for (const stagedEntry of stagedProof.files) {
    const relative = assertNotGitPath(stagedEntry.path);
    await assertSafePathComponents(target, relative);
    const output = resolveInside(target, relative);
    const details = await maybeLstat(output);
    if (details && !details.isFile()) fail(`application collision is not a regular file: ${relative}`);
    const original = details ? await readFile(output) : null;
    const rule = rules.get(relative);
    let action;
    if (!details) action = rule?.onAbsent ?? policy.defaultAbsentAction;
    else if (rule) action = rule.onPresent;
    else if (isProtectedPath(policy, relative)) action = policy.protectedCollisionAction;
    else action = policy.defaultPresentAction;

    let result;
    if (action === 'create-if-absent') {
      if (details) fail(`create-if-absent collided with existing path: ${relative}`);
      result = stagedEntry.bytes;
    } else if (action === 'preserve-existing') {
      if (!details) fail(`preserve-existing requires an existing path: ${relative}`);
      result = original;
    } else if (action === 'append-marked-block') {
      if (!details || !rule?.markers) fail(`append-marked-block requires an existing path and markers: ${relative}`);
      result = appendMarkedBlock(original, stagedEntry.bytes, rule.markers, relative);
    } else if (action === 'merge-lines') {
      if (!details) fail(`merge-lines requires an existing path: ${relative}`);
      result = mergeLines(original, stagedEntry.bytes, relative);
    } else {
      fail(`unsupported application action ${action} for ${relative}`);
    }

    plan.push({
      path: relative,
      output,
      action,
      original,
      staged: stagedEntry.bytes,
      result,
      originalMode: details ? modeString(details) : null,
      resultMode: details ? modeString(details) : stagedEntry.mode,
      rule,
    });
  }

  const visiblePaths = manifest.residentInstructionsVisibleBeforeFirstTurn ?? [];
  const visibleProofs = [];
  for (const visiblePath of visiblePaths) {
    const relative = assertNotGitPath(visiblePath);
    const entry = plan.find((candidate) => candidate.path === relative);
    if (!entry) fail(`visible instruction path is not selected: ${relative}`);
    if (!entry.result.includes(entry.staged)) fail(`candidate instructions are not visible in result: ${relative}`);
    const proof = {
      path: relative,
      action: entry.action,
      stagedSha256: sha256(entry.staged),
      resultSha256: sha256(entry.result),
      exactStagedBytesVisible: true,
    };
    if (entry.action === 'append-marked-block') {
      const { begin, end } = entry.rule.markers;
      const beginBytes = Buffer.from(`${begin}\n`, 'utf8');
      const endBytes = Buffer.from(`${end}\n`, 'utf8');
      const beginIndex = entry.result.indexOf(beginBytes);
      const endIndex = entry.result.indexOf(endBytes, beginIndex + beginBytes.length);
      if (beginIndex < 0 || endIndex < 0) fail(`visible instruction markers are missing: ${relative}`);
      const embedded = entry.result.subarray(beginIndex + beginBytes.length, endIndex);
      const expectedEmbedded = entry.staged.at(-1) === 10 ? entry.staged : Buffer.concat([entry.staged, Buffer.from('\n')]);
      if (!embedded.equals(expectedEmbedded)) fail(`visible instruction marker block differs from staged bytes: ${relative}`);
      proof.markers = { begin, end };
      proof.originalBytesPreserved = entry.original !== null
        && entry.result.subarray(0, entry.original.length).equals(entry.original);
      if (!proof.originalBytesPreserved) fail(`existing instruction bytes were not preserved: ${relative}`);
    }
    visibleProofs.push(proof);
  }

  const createdTargetDirectories = new Set();
  for (const entry of plan) {
    if (entry.action === 'preserve-existing') continue;
    for (const directory of await missingTargetDirectories(target, entry.path)) {
      createdTargetDirectories.add(directory);
    }
  }
  const createdReceiptDirectories = await missingAbsoluteDirectoryChain(path.dirname(receiptPath));
  const mutated = [];
  try {
    for (const entry of plan) {
      if (entry.action === 'preserve-existing') continue;
      await mkdir(path.dirname(entry.output), { recursive: true });
      mutated.push(entry);
      await writeFile(entry.output, entry.result);
      await chmod(entry.output, Number.parseInt(entry.resultMode, 8));
    }

    const resultSnapshot = await treeSnapshot(target);
    const receiptFiles = plan.map((entry) => ({
      path: entry.path,
      action: entry.action,
      originalSha256: entry.original === null ? null : sha256(entry.original),
      stagedSha256: sha256(entry.staged),
      resultSha256: sha256(entry.result),
      originalBytes: entry.original?.length ?? null,
      stagedBytes: entry.staged.length,
      resultBytes: entry.result.length,
      resultMode: entry.resultMode,
    })).sort((left, right) => left.path.localeCompare(right.path));
    const receipt = {
      schemaVersion: 1,
      operation: 'apply',
      candidateId: manifest.candidateId,
      activationProfile: selected.profile.id,
      taskClasses: selected.profile.taskClasses,
      platform,
      manifestSha256: digest,
      applicationPolicySha256: manifest.applicationPolicySha256,
      materializationReceiptSha256: stagedProof.receiptSha256,
      originalTreeSha256: originalSnapshot.sha256,
      stagedTreeSha256: stagedProof.treeSha256,
      resultingTreeSha256: resultSnapshot.sha256,
      totals: {
        selectedFiles: receiptFiles.length,
        created: receiptFiles.filter((entry) => entry.action === 'create-if-absent').length,
        preserved: receiptFiles.filter((entry) => entry.action === 'preserve-existing').length,
        appended: receiptFiles.filter((entry) => entry.action === 'append-marked-block').length,
        merged: receiptFiles.filter((entry) => entry.action === 'merge-lines').length,
        resultingTreeFiles: resultSnapshot.totals.files,
        resultingTreeBytes: resultSnapshot.totals.bytes,
      },
      visibleInstructionProof: {
        allDeclaredInstructionsVisible: visibleProofs.length === visiblePaths.length,
        paths: visibleProofs,
      },
      files: receiptFiles,
    };
    await mkdir(path.dirname(receiptPath), { recursive: true });
    await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  } catch (error) {
    const rollbackErrors = [];
    try {
      await removePartialReceipt(receiptPath);
    } catch (rollbackError) {
      rollbackErrors.push(rollbackError);
    }
    for (const entry of mutated.reverse()) {
      try {
        if (entry.original === null) await rm(entry.output, { force: true });
        else {
          await writeFile(entry.output, entry.original);
          await chmod(entry.output, Number.parseInt(entry.originalMode, 8));
        }
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError);
      }
    }
    try {
      await removeEmptyDirectories(createdTargetDirectories);
      await removeEmptyDirectories(createdReceiptDirectories);
    } catch (rollbackError) {
      rollbackErrors.push(rollbackError);
    }
    if (rollbackErrors.length > 0) {
      throw new AggregateError([error, ...rollbackErrors], 'application failed and rollback was incomplete');
    }
    throw error;
  }
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
else if (options.command === 'apply') await apply(options, loaded);
else await teardown(options, loaded);
