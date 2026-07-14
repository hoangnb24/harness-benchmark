#!/usr/bin/env node
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  assertFrozenTask,
  canonicalJson,
  loadCorpus,
  readJson,
  sha256,
  writeFileMap,
} from './corpus-lib.mjs';
import { initializeStartCommit, materializeAtomicFixture } from './materialize-fixture.mjs';
import { evaluateCheck, runAtomicRubric } from './rubric-runner.mjs';

const ACTIVATION_PROFILES = [
  'read-only-diagnosis',
  'tiny-documentation',
  'bounded-defect-repair',
  'normal-behavior-change',
  'high-risk-identity-data',
  'brownfield-ownership',
  'runtime-observability',
  'cumulative-coordination',
];
const BEHAVIOR_TASKS = new Set([
  'P0-A05-defect-page-boundary',
  'P0-A06-defect-slug',
  'P0-A07-feature-label-filter',
  'P0-A08-feature-archive',
  'P0-A09-identity-tenant',
  'P0-A10-identity-token',
  'P0-A11-data-migration',
  'P0-A12-release-checksum',
]);

function ensure(condition, message) {
  if (!condition) throw new Error(message);
}

async function expectReject(label, action) {
  try {
    await action();
  } catch {
    return { label, status: 'rejected' };
  }
  throw new Error(`${label} canary did not fail closed`);
}

async function applySolution(root, solution) {
  await writeFileMap(root, solution ?? {});
}

async function materializePair(corpus, task, root) {
  const records = [];
  for (const reset of [1, 2]) {
    const workspace = path.join(root, task.id, `reset-${reset}`);
    const receipt = path.join(root, task.id, `reset-${reset}.json`);
    records.push(await materializeAtomicFixture({ corpus, taskId: task.id, workspace, output: workspace, receipt }));
  }
  ensure(records[0].materializedTreeSha256 === records[1].materializedTreeSha256, `${task.id} resets differ`);
  ensure(records[0].startCommit === records[1].startCommit, `${task.id} reset commits differ`);
  ensure(records[0].startCommit === assertFrozenTask(corpus, task).startCommit, `${task.id} reset commit is not locked`);
  return records;
}

async function scorePositive(corpus, canaries, task, root) {
  const workspace = path.join(root, 'positive', task.id, 'workspace');
  const receipt = path.join(root, 'positive', task.id, 'start.json');
  const submission = path.join(root, 'positive', task.id, 'submission');
  await materializeAtomicFixture({ corpus, taskId: task.id, output: workspace, receipt });
  await mkdir(submission, { recursive: true });
  const solution = canaries.atomicSolutions[task.id];
  ensure(solution, `${task.id} positive canary is missing`);
  await applySolution(workspace, solution.workspace);
  await applySolution(submission, solution.submission);
  const score = await runAtomicRubric({ corpus, taskId: task.id, workspace, submission, receipt });
  ensure(score.status === 'passed', `${task.id} positive canary failed: ${JSON.stringify(score.results)}`);
  ensure(score.denominator === task.rubric.denominator, `${task.id} positive denominator drifted`);
  return score;
}

async function verifyCumulative(corpus, canaries, root) {
  ensure(corpus.cumulative.journeys.length === 1, 'exactly one cumulative journey is required');
  const journey = corpus.cumulative.journeys[0];
  const locked = corpus.lock.cumulativeJourneys.find((item) => item.id === journey.id);
  ensure(journey.taskClass === 'cumulative-coordination', 'journey has wrong activation profile');
  ensure(journey.atomic === false && journey.excludedFromAtomicScores === true, 'journey can leak into atomic scores');
  ensure(locked?.fixtureSha256 === sha256(canonicalJson(journey.fixture)), 'cumulative fixture identity drifted');
  const commits = [];
  for (const reset of [1, 2]) {
    const workspace = path.join(root, 'cumulative', `reset-${reset}`);
    await mkdir(workspace, { recursive: true });
    await writeFileMap(workspace, journey.fixture.files);
    commits.push(await initializeStartCommit(workspace, journey.fixture.seedId));
  }
  ensure(commits[0] === commits[1] && commits[0] === locked.startCommit, 'cumulative reset commit drifted');
  const workspace = path.join(root, 'cumulative', 'positive', 'workspace');
  const submission = path.join(root, 'cumulative', 'positive', 'submission');
  await mkdir(workspace, { recursive: true });
  await mkdir(submission, { recursive: true });
  await writeFileMap(workspace, journey.fixture.files);
  await applySolution(workspace, canaries.cumulativeSolution.workspace);
  await applySolution(submission, canaries.cumulativeSolution.submission);
  const stepScores = [];
  for (const step of journey.steps) {
    const lockStep = locked.steps.find((item) => item.id === step.id);
    ensure(lockStep?.promptSha256 === sha256(step.prompt), `${step.id} prompt identity drifted`);
    ensure(lockStep?.rubricSha256 === sha256(canonicalJson(step.rubric)), `${step.id} rubric identity drifted`);
    ensure(step.rubric.denominator === step.rubric.checks.length, `${step.id} denominator drifted`);
    const results = [];
    for (const check of step.rubric.checks) {
      results.push(await evaluateCheck(check, { workspace, submission, receipt: { files: {} } }));
    }
    ensure(results.every(Boolean), `${step.id} cumulative positive canary failed`);
    stepScores.push({ id: step.id, passed: results.length, denominator: step.rubric.denominator });
  }
  return { journeyId: journey.id, resets: 2, steps: stepScores, excludedFromAtomicScores: true };
}

async function main() {
  const corpus = await loadCorpus();
  const canaries = await readJson(path.join(import.meta.dirname, 'canaries.json'));
  const frozenReceipt = await readJson(path.join(import.meta.dirname, 'verification-receipt.json'));
  const root = await mkdtemp(path.join(tmpdir(), 'e13-us105-'));
  try {
    ensure(corpus.atomic.tasks.length >= 16, 'atomic corpus must contain at least 16 tasks');
    ensure(corpus.lock.atomicCatalogSha256 === sha256(canonicalJson(corpus.atomic)), 'atomic catalog identity drifted');
    ensure(corpus.lock.cumulativeCatalogSha256 === sha256(canonicalJson(corpus.cumulative)), 'cumulative catalog identity drifted');
    const atomicProfiles = ACTIVATION_PROFILES.slice(0, -1);
    ensure(canonicalJson(corpus.atomic.requiredClasses) === canonicalJson(atomicProfiles), 'atomic class list differs from US-106');
    const taskIds = new Set();
    const seeds = new Set();
    const counts = Object.fromEntries(atomicProfiles.map((id) => [id, 0]));
    for (const task of corpus.atomic.tasks) {
      ensure(!taskIds.has(task.id), `duplicate task id ${task.id}`);
      ensure(!seeds.has(task.fixture.seedId), `duplicate seed id ${task.fixture.seedId}`);
      ensure(task.dependencies.length === 0 && task.fixture.lineage === 'independent', `${task.id} is not atomic`);
      ensure(atomicProfiles.includes(task.taskClass), `${task.id} has non-US-106 class ${task.taskClass}`);
      ensure(task.rubric.denominator === task.rubric.checks.length, `${task.id} denominator differs from checks`);
      ensure(task.rubric.checks.length > 0, `${task.id} has no rubric checks`);
      if (BEHAVIOR_TASKS.has(task.id)) {
        ensure(task.rubric.checks.some((check) => check.kind === 'command' && check.critical), `${task.id} lacks a critical executable behavior check`);
      }
      assertFrozenTask(corpus, task);
      taskIds.add(task.id);
      seeds.add(task.fixture.seedId);
      counts[task.taskClass] += 1;
    }
    for (const [profile, count] of Object.entries(counts)) ensure(count >= 2, `${profile} has fewer than two atomic tasks`);
    ensure(counts['high-risk-identity-data'] >= 4, 'combined high-risk class lacks identity and data/release depth');
    ensure(corpus.atomic.tasks.every((task) => !task.id.startsWith('P0-J')), 'journey step leaked into atomic catalog');

    const resetProof = [];
    for (const task of corpus.atomic.tasks) {
      const records = await materializePair(corpus, task, root);
      resetProof.push({ taskId: task.id, resets: 2, startCommit: records[0].startCommit, treeSha256: records[0].materializedTreeSha256 });
    }
    ensure(
      canonicalJson(resetProof.map(({ taskId, startCommit, treeSha256 }) => ({ taskId, startCommit, treeSha256 }))) ===
        canonicalJson(frozenReceipt.atomicResetProof),
      'frozen reset receipt differs from executable reset proof',
    );
    const positives = [];
    for (const task of corpus.atomic.tasks) positives.push(await scorePositive(corpus, canaries, task, root));

    const negatives = [];
    const missingRubric = structuredClone(corpus);
    missingRubric.atomic.tasks[0].rubric = null;
    missingRubric.lock.atomicTasks[0].rubricSha256 = sha256(canonicalJson(null));
    negatives.push(await expectReject('missing-rubric', () => runAtomicRubric({ corpus: missingRubric, taskId: missingRubric.atomic.tasks[0].id, workspace: root, submission: root, receipt: path.join(root, 'absent.json') })));

    const falseWorkspace = path.join(root, 'negative-false-positive', 'workspace');
    const falseReceipt = path.join(root, 'negative-false-positive', 'start.json');
    const falseSubmission = path.join(root, 'negative-false-positive', 'submission');
    await materializeAtomicFixture({ corpus, taskId: 'P0-A09-identity-tenant', output: falseWorkspace, receipt: falseReceipt });
    await mkdir(falseSubmission, { recursive: true });
    await applySolution(falseWorkspace, {
      'src/auth.js': '// user.tenantId === record.tenantId\nexport function canRead(user) { return Boolean(user); }\n',
    });
    await applySolution(falseSubmission, canaries.atomicSolutions['P0-A09-identity-tenant'].submission);
    const falseScore = await runAtomicRubric({ corpus, taskId: 'P0-A09-identity-tenant', workspace: falseWorkspace, submission: falseSubmission, receipt: falseReceipt });
    ensure(falseScore.status === 'failed' && falseScore.criticalFailure, 'comment-only false-positive canary passed');
    negatives.push({ label: 'false-positive', status: 'rejected' });

    const safetyWorkspace = path.join(root, 'negative-safety', 'workspace');
    const safetyReceipt = path.join(root, 'negative-safety', 'start.json');
    const safetySubmission = path.join(root, 'negative-safety', 'submission');
    await materializeAtomicFixture({ corpus, taskId: 'P0-A09-identity-tenant', output: safetyWorkspace, receipt: safetyReceipt });
    await mkdir(safetySubmission, { recursive: true });
    await applySolution(safetyWorkspace, { 'src/auth.js': 'export function canRead(user, record) { const allowAll = true; return true; }\n' });
    await applySolution(safetySubmission, canaries.atomicSolutions['P0-A09-identity-tenant'].submission);
    const safetyScore = await runAtomicRubric({ corpus, taskId: 'P0-A09-identity-tenant', workspace: safetyWorkspace, submission: safetySubmission, receipt: safetyReceipt });
    ensure(safetyScore.status === 'failed' && safetyScore.criticalFailure, 'safety canary did not fail critically');
    negatives.push({ label: 'safety', status: 'rejected' });

    const denominatorWorkspace = path.join(root, 'negative-denominator', 'workspace');
    const denominatorReceipt = path.join(root, 'negative-denominator', 'start.json');
    const denominatorSubmission = path.join(root, 'negative-denominator', 'submission');
    await materializeAtomicFixture({ corpus, taskId: 'P0-A03-doc-command', output: denominatorWorkspace, receipt: denominatorReceipt });
    await mkdir(denominatorSubmission, { recursive: true });
    await applySolution(denominatorWorkspace, canaries.atomicSolutions['P0-A03-doc-command'].workspace);
    const denominatorScore = await runAtomicRubric({ corpus, taskId: 'P0-A03-doc-command', workspace: denominatorWorkspace, submission: denominatorSubmission, receipt: denominatorReceipt });
    ensure(denominatorScore.status === 'failed' && denominatorScore.denominator === 4 && denominatorScore.passed === 3, 'denominator canary did not preserve the fixed denominator');
    negatives.push({ label: 'denominator', status: 'rejected' });

    const contaminationWorkspace = path.join(root, 'negative-contamination', 'workspace');
    const contaminationReceipt = path.join(root, 'negative-contamination', 'start.json');
    const contaminationSubmission = path.join(root, 'negative-contamination', 'submission');
    await materializeAtomicFixture({ corpus, taskId: 'P0-A01-diagnose-timeout', output: contaminationWorkspace, receipt: contaminationReceipt });
    await mkdir(contaminationSubmission, { recursive: true });
    let reusedStartRejected = false;
    try {
      await materializeAtomicFixture({
        corpus,
        taskId: 'P0-A02-diagnose-cache',
        output: contaminationWorkspace,
        receipt: path.join(root, 'negative-contamination', 'second-start.json'),
      });
    } catch {
      reusedStartRejected = true;
    }
    await applySolution(contaminationSubmission, canaries.atomicSolutions['P0-A01-diagnose-timeout'].submission);
    await writeFile(path.join(contaminationWorkspace, 'foreign-task-output.txt'), 'contaminated\n');
    const contaminatedScore = await runAtomicRubric({ corpus, taskId: 'P0-A01-diagnose-timeout', workspace: contaminationWorkspace, submission: contaminationSubmission, receipt: contaminationReceipt });
    ensure(contaminatedScore.status === 'failed' && contaminatedScore.criticalFailure, 'contaminated workspace did not fail critically');
    const tampered = await readJson(contaminationReceipt);
    tampered.fixtureSha256 = '0'.repeat(64);
    await writeFile(contaminationReceipt, `${JSON.stringify(tampered)}\n`);
    let receiptRejected = false;
    try {
      await runAtomicRubric({ corpus, taskId: 'P0-A01-diagnose-timeout', workspace: contaminationWorkspace, submission: contaminationSubmission, receipt: contaminationReceipt });
    } catch {
      receiptRejected = true;
    }
    ensure(reusedStartRejected && receiptRejected, 'contamination identity did not fail closed');
    negatives.push({ label: 'contamination', status: 'rejected' });

    const cumulative = await verifyCumulative(corpus, canaries, root);
    const behaviorCommandReceipts = positives.flatMap((score) =>
      score.results
        .filter((result) => result.evidence)
        .map((result) => ({ taskId: score.taskId, checkId: result.id, ...result.evidence })),
    );
    ensure(behaviorCommandReceipts.length === BEHAVIOR_TASKS.size, 'behavior command receipt count drifted');
    ensure(behaviorCommandReceipts.every((item) => item.exitCode === 0), 'a passing behavior command lacks exit-zero proof');
    ensure(frozenReceipt.positiveCanaries.passed === positives.length, 'frozen positive-canary receipt drifted');
    ensure(Object.values(frozenReceipt.negativeCanaries).every((status) => status === 'rejected'), 'frozen negative-canary receipt drifted');
    ensure(frozenReceipt.cumulative.excludedFromAtomicScores === true, 'frozen cumulative receipt leaks into atomic scores');
    const receipt = {
      schemaVersion: 1,
      corpusId: corpus.atomic.corpusId,
      activationProfiles: ACTIVATION_PROFILES,
      atomicTasks: corpus.atomic.tasks.length,
      classCounts: counts,
      resetProof,
      positiveCanaries: positives.map((score) => ({ taskId: score.taskId, passed: score.passed, denominator: score.denominator })),
      behaviorCommandReceipts,
      negativeCanaries: negatives,
      cumulative,
      liveAgentInvocations: 0,
      status: 'passed',
    };
    process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

await main();
