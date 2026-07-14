#!/usr/bin/env node
import { execFile as execFileCallback } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import {
  assertFrozenTask,
  findAtomicTask,
  loadCorpus,
  pathExists,
  readJson,
  sha256,
} from './corpus-lib.mjs';

const execFile = promisify(execFileCallback);

async function textAt(root, relative) {
  const target = path.join(root, relative);
  if (!(await pathExists(target))) return null;
  return readFile(target, 'utf8');
}

export async function evaluateCheck(check, context) {
  if (check.kind === 'command') {
    if (!Array.isArray(check.command) || check.command.length === 0) {
      throw new Error(`command check ${check.id} has no argv`);
    }
    const [executable, ...args] = check.command;
    const timeout = check.timeoutMs ?? 5000;
    try {
      const { stdout, stderr } = await execFile(executable, args, {
        cwd: context.workspace,
        encoding: 'utf8',
        timeout,
        maxBuffer: 1024 * 1024,
      });
      const outputMatches = (check.stdoutIncludes ?? []).every((value) => stdout.includes(value));
      return {
        pass: outputMatches,
        evidence: {
          argv: check.command,
          timeoutMs: timeout,
          exitCode: 0,
          stdoutSha256: sha256(stdout),
          stderrSha256: sha256(stderr),
        },
      };
    } catch (cause) {
      return {
        pass: false,
        evidence: {
          argv: check.command,
          timeoutMs: timeout,
          exitCode: Number.isInteger(cause?.code) ? cause.code : null,
          signal: cause?.signal ?? null,
          timedOut: Boolean(cause?.killed),
          stdoutSha256: sha256(cause?.stdout ?? ''),
          stderrSha256: sha256(cause?.stderr ?? ''),
        },
      };
    }
  }
  const root = check.scope === 'submission' ? context.submission : context.workspace;
  if (check.kind === 'contains') {
    const value = await textAt(root, check.path);
    return value !== null && check.values.every((needle) => value.includes(needle));
  }
  if (check.kind === 'not_contains') {
    const value = await textAt(root, check.path);
    return value !== null && check.values.every((needle) => !value.includes(needle));
  }
  if (check.kind === 'absent') return !(await pathExists(path.join(root, check.path)));
  if (check.kind === 'unchanged') {
    const value = await textAt(context.workspace, check.path);
    return value !== null && sha256(value) === context.receipt.files[check.path];
  }
  if (check.kind === 'workspace_unchanged') {
    const { directoryIdentity } = await import('./corpus-lib.mjs');
    return (await directoryIdentity(context.workspace)).sha256 === context.receipt.materializedTreeSha256;
  }
  throw new Error(`unknown rubric check kind: ${check.kind}`);
}

export async function runAtomicRubric({ corpus, taskId, workspace, submission, receipt }) {
  const task = findAtomicTask(corpus, taskId);
  const locked = assertFrozenTask(corpus, task);
  if (!task.rubric || !Array.isArray(task.rubric.checks) || task.rubric.checks.length === 0) {
    throw new Error(`${taskId} rubric is absent or empty`);
  }
  if (task.rubric.denominator !== task.rubric.checks.length) {
    throw new Error(`${taskId} fixed denominator does not match rubric checks`);
  }
  const start = await readJson(receipt);
  if (
    start.taskId !== taskId ||
    start.fixtureSha256 !== locked.fixtureSha256 ||
    start.seedId !== task.fixture.seedId
  ) {
    throw new Error(`${taskId} start receipt does not match frozen fixture`);
  }
  const results = [];
  for (const check of task.rubric.checks) {
    let pass = false;
    let error = null;
    let evidence = null;
    try {
      const evaluated = await evaluateCheck(check, { workspace, submission, receipt: start });
      if (typeof evaluated === 'boolean') pass = evaluated;
      else {
        pass = evaluated.pass;
        evidence = evaluated.evidence;
      }
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    }
    results.push({ id: check.id, pass, critical: Boolean(check.critical), error, evidence });
  }
  const passed = results.filter((item) => item.pass).length;
  const criticalFailure = results.some((item) => item.critical && !item.pass);
  return {
    schemaVersion: 1,
    taskId,
    rubricSha256: locked.rubricSha256,
    passed,
    denominator: task.rubric.denominator,
    criticalFailure,
    status: passed === task.rubric.denominator && !criticalFailure ? 'passed' : 'failed',
    results,
  };
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
  if (!options.task || !options.workspace || !options.submission || !options.receipt) {
    throw new Error(
      'usage: rubric-runner.mjs --task ID --workspace DIR --submission DIR --receipt FILE',
    );
  }
  const result = await runAtomicRubric({
    corpus: await loadCorpus(),
    taskId: options.task,
    workspace: path.resolve(options.workspace),
    submission: path.resolve(options.submission),
    receipt: path.resolve(options.receipt),
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (result.status !== 'passed') process.exitCode = 1;
}
