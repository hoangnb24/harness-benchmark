#!/usr/bin/env node

import path from 'node:path';
import { lstat, readdir, realpath } from 'node:fs/promises';
import { GenerateEvaluationAggregate } from '../application/GenerateEvaluationAggregate';
import { GenerateCumulativeEvaluationAggregate } from '../application/GenerateCumulativeEvaluationAggregate';
import { GenerateCalibrationAggregate } from '../application/GenerateCalibrationAggregate';
import { RunCumulativeEvaluationPlan } from '../application/RunCumulativeEvaluationPlan';
import { RunEvaluationCell } from '../application/RunEvaluationCell';
import { RunEvaluationPlan } from '../application/RunEvaluationPlan';
import { CommandEvaluationTreatmentMaterializer } from '../infrastructure/CommandEvaluationTreatmentMaterializer';
import { CodexEvaluationAgent } from '../infrastructure/CodexEvaluationAgent';
import { verifyCodexExecutionAuthorization } from '../infrastructure/CodexExecutionAuthorization';
import { BudgetedEvaluationAgent } from '../infrastructure/BudgetedEvaluationAgent';
import { FakeEvaluationAgent } from '../infrastructure/FakeEvaluationAgent';
import { FsRawCellStore } from '../infrastructure/FsRawCellStore';
import { JsonEvaluationPlanLoader } from '../infrastructure/JsonEvaluationPlanLoader';
import { Phase0EvaluationWorkspace } from '../infrastructure/Phase0EvaluationWorkspace';
import { Phase0CumulativeJourneyExecutor } from '../infrastructure/Phase0CumulativeJourneyExecutor';
import { Phase0RubricEvaluator } from '../infrastructure/Phase0RubricEvaluator';
import { assertHeldOutCalibrationPlan, isHeldOutCalibrationPlan } from '../domain/calibration';
import type { EvaluationPlan } from '../domain/evaluation';

interface EvaluationCliIo {
  stdout: (message: string) => void;
  stderr: (message: string) => void;
}

const defaultIo: EvaluationCliIo = {
  stdout: (message) => process.stdout.write(message),
  stderr: (message) => process.stderr.write(message),
};

export async function runEvaluationCli(
  args: string[],
  io: EvaluationCliIo = defaultIo,
): Promise<number> {
  const [command, ...rest] = args;
  const planPath = flag(rest, '--plan');
  const runDir = flag(rest, '--run-dir');
  if (!planPath || !runDir ||
    !['qualify', 'report', 'verify', 'calibration-report', 'calibration-verify'].includes(command ?? '')) {
    io.stderr(
      'Usage: evaluation-cli <qualify|report|verify|calibration-report|calibration-verify> --plan PLAN.json --run-dir DIR [--materializer FILE]\n',
    );
    return 1;
  }
  try {
    const plan = await new JsonEvaluationPlanLoader().load(planPath);
    assertCalibrationCommandBoundary(command, plan);
    if (command === 'qualify' && plan.agent.kind === 'codex') await assertFreshCodexRunDir(runDir);
    if (command === 'qualify' && plan.agent.kind === 'codex') {
      const externallyApprovedSha = flag(rest, '--approved-authorization-sha');
      if (!rest.includes('--allow-live-codex')) {
        throw new Error('Codex execution requires the literal --allow-live-codex flag');
      }
      if (!externallyApprovedSha || !/^[a-f0-9]{64}$/.test(externallyApprovedSha)) {
        throw new Error('Codex execution requires --approved-authorization-sha with a lowercase SHA-256');
      }
      if (externallyApprovedSha !== plan.agent.authorization.sha256) {
        throw new Error('external Codex authorization SHA does not match the plan');
      }
    }
    const authorization = await verifyCodexExecutionAuthorization(plan, runDir);
    const rubric = new Phase0RubricEvaluator({
      lockSha256: plan.corpus.lockSha256,
      atomicCatalogSha256: plan.corpus.atomicCatalogSha256,
    });
    const aggregate = new GenerateEvaluationAggregate(rubric);
    const calibrationAggregate = new GenerateCalibrationAggregate(aggregate);
    const cumulativeAggregate = new GenerateCumulativeEvaluationAggregate();
    if (command === 'calibration-report') {
      const result = await calibrationAggregate.write(plan, runDir);
      io.stdout(`${JSON.stringify(result)}\n`);
      return result.infrastructureValidity === 'valid' ? 0 : 1;
    }
    if (command === 'calibration-verify') {
      const result = await calibrationAggregate.verify(plan, runDir);
      io.stdout(`${JSON.stringify(result)}\n`);
      return result.infrastructureValidity === 'valid' ? 0 : 1;
    }
    if (command === 'report') {
      const atomicBuilt = plan.cells.length > 0 ? await aggregate.build(plan, runDir) : undefined;
      const cumulative = plan.cumulativeJourneys.length > 0
        ? await cumulativeAggregate.verify(plan, runDir)
        : undefined;
      // Do not publish an atomic aggregate until every mixed-plan evidence set validates.
      const atomic = atomicBuilt ? await aggregate.write(plan, runDir) : undefined;
      const result = atomic ?? cumulative;
      io.stdout(`${JSON.stringify(result)}\n`);
      return 0;
    }
    if (command === 'verify') {
      const atomic = plan.cells.length > 0 ? await aggregate.verify(plan, runDir) : undefined;
      const cumulative = plan.cumulativeJourneys.length > 0
        ? await cumulativeAggregate.verify(plan, runDir)
        : undefined;
      const result = atomic ?? cumulative;
      io.stdout(`${JSON.stringify(result)}\n`);
      return 0;
    }

    const store = new FsRawCellStore(runDir);
    const materializer = new CommandEvaluationTreatmentMaterializer(
      flag(rest, '--materializer') ?? path.resolve('benchmark/candidates/e13/materialize-candidate.mjs'),
    );
    const executionBudgetStartedAt = Date.now();
    const codexExecutor = plan.agent.kind === 'codex'
      ? new CodexEvaluationAgent(
          plan.agent.executable,
          plan.model.declared,
          plan.reasoningEffort,
          authorization!.pricing,
          plan.agent.pricingPolicy.sha256,
          authorization!.toolPolicy,
          plan.agent.toolPolicy.sha256,
          authorization!.limits.maxElapsedSeconds,
          executionBudgetStartedAt,
        )
      : undefined;
    const baseExecutor = plan.agent.kind === 'fake'
      ? new FakeEvaluationAgent(plan.agent.command, plan.agent.args)
      : codexExecutor!;
    await preflightAtomicCells(plan, rubric, materializer);
    const preflightCumulativeExecutor = new Phase0CumulativeJourneyExecutor(
      materializer,
      baseExecutor,
      runDir,
    );
    let plannedInvocations = plan.cells.length;
    for (const journey of plan.cumulativeJourneys) {
      plannedInvocations += await preflightCumulativeExecutor.preflight(plan, journey);
    }
    if (authorization && plannedInvocations > authorization.limits.maxInvocations) {
      throw new Error('planned Codex invocations exceed the approved invocation ceiling');
    }
    if (codexExecutor) await codexExecutor.preflight();
    const executor = plan.agent.kind === 'fake'
      ? baseExecutor
      : new BudgetedEvaluationAgent(baseExecutor, authorization!.limits, executionBudgetStartedAt);
    const cumulativeExecutor = new Phase0CumulativeJourneyExecutor(materializer, executor, runDir);
    const runCell = new RunEvaluationCell(
      new Phase0EvaluationWorkspace(),
      materializer,
      executor,
      rubric,
      store,
    );
    const records = await new RunEvaluationPlan(runCell, rubric, store).execute(plan);
    const cumulativeRecords = await new RunCumulativeEvaluationPlan(
      cumulativeExecutor,
    ).execute(plan);
    if (cumulativeRecords.length > 0) {
      await cumulativeAggregate.write(plan, runDir);
    }
    io.stdout(`${JSON.stringify({
      runId: plan.runId,
      cells: records.length,
      cumulativeJourneys: cumulativeRecords.length,
    })}\n`);
    return 0;
  } catch (error) {
    io.stderr(`Evaluation failed: ${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

export function assertCalibrationCommandBoundary(command: string, plan: EvaluationPlan): void {
  const heldOutCalibration = isHeldOutCalibrationPlan(plan);
  const calibrationScope = plan.agent.kind === 'codex' && plan.agent.scope === 'calibration';
  if (calibrationScope || heldOutCalibration) assertHeldOutCalibrationPlan(plan);
  if ((command === 'report' || command === 'verify') && heldOutCalibration) {
    throw new Error('calibration evidence is excluded from decision report and verification commands');
  }
  if ((command === 'calibration-report' || command === 'calibration-verify') &&
    (!calibrationScope || !heldOutCalibration)) {
    throw new Error('calibration report commands accept only a held-out calibration plan');
  }
}

async function preflightAtomicCells(
  plan: Awaited<ReturnType<JsonEvaluationPlanLoader['load']>>,
  rubric: Phase0RubricEvaluator,
  materializer: CommandEvaluationTreatmentMaterializer,
): Promise<void> {
  const workspace = new Phase0EvaluationWorkspace();
  for (const cell of plan.cells) {
    const loaded = await rubric.load(cell, plan.corpus.root);
    const prepared = await workspace.prepare(cell, plan.corpus.root);
    try {
      if (
        prepared.fixture.taskId !== loaded.taskId ||
        prepared.fixture.fixtureSha256 !== loaded.fixtureSha256 ||
        prepared.fixture.startCommit !== loaded.startCommit
      ) {
        throw new Error(`atomic preflight fixture identity mismatch: ${cell.id}`);
      }
      await materializer.materializeAndApply(cell, prepared.workspaceDir, prepared.rootDir);
    } finally {
      await workspace.dispose(prepared.rootDir);
    }
  }
}

async function assertFreshCodexRunDir(runDir: string): Promise<void> {
  if (!path.isAbsolute(runDir)) throw new Error('Codex run directory must be absolute');
  const parent = path.dirname(runDir);
  const parentDetails = await lstat(parent);
  if (!parentDetails.isDirectory() || parentDetails.isSymbolicLink() || await realpath(parent) !== parent) {
    throw new Error('Codex run-directory parent must be an existing canonical non-symbolic-link directory');
  }
  try {
    const details = await lstat(runDir);
    if (!details.isDirectory() || details.isSymbolicLink()) {
      throw new Error('Codex run directory must be a non-symbolic-link directory');
    }
    if (await realpath(runDir) !== runDir) {
      throw new Error('Codex run directory must already be its canonical real path');
    }
    if ((await readdir(runDir)).length !== 0) {
      throw new Error('Codex run directory must be new or empty before execution');
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
}

function flag(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

if (require.main === module) {
  void runEvaluationCli(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
