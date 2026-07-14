#!/usr/bin/env node
import path from 'node:path';
import { readJson, sha256 } from '../../../phase0/corpus-lib.mjs';
import { evaluateCheck } from '../../../phase0/rubric-runner.mjs';
import { assertFrozenCalibrationTask, findCalibrationTask, loadCalibrationCorpus } from './calibration-lib.mjs';

export async function runCalibrationRubric({ corpus, taskId, workspace, submission, receipt }) {
  const task = findCalibrationTask(corpus, taskId);
  const frozen = assertFrozenCalibrationTask(corpus, task);
  const start = await readJson(receipt);
  if (start.taskId !== taskId || start.fixtureSha256 !== frozen.fixtureSha256 ||
    start.dirtyBaseline?.correctBeforeTreatment !== true) throw new Error(`${taskId} rubric start identity mismatch`);
  const results = [];
  for (const check of task.rubric.checks) {
    let pass = false; let error = null; let evidence = null;
    try {
      const value = await evaluateCheck(check, { workspace, submission, receipt: start });
      if (typeof value === 'boolean') pass = value;
      else { pass = value.pass; evidence = value.evidence; }
    } catch (cause) { error = cause instanceof Error ? cause.message : String(cause); }
    results.push({ id: check.id, pass, critical: Boolean(check.critical), error, evidence });
  }
  return { schemaVersion: 1, taskId, rubricSha256: frozen.rubricSha256,
    denominator: task.rubric.denominator, results };
}

function args(argv) { const output = {}; for (let i = 0; i < argv.length; i += 2) output[argv[i].slice(2)] = argv[i + 1]; return output; }
if (import.meta.url === `file://${process.argv[1]}`) {
  const options = args(process.argv.slice(2));
  const result = await runCalibrationRubric({ corpus: await loadCalibrationCorpus(), taskId: options.task,
    workspace: path.resolve(options.workspace), submission: path.resolve(options.submission), receipt: path.resolve(options.receipt) });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
