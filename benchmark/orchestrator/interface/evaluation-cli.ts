#!/usr/bin/env node

import path from 'node:path';
import { GenerateEvaluationAggregate } from '../application/GenerateEvaluationAggregate';
import { RunEvaluationCell } from '../application/RunEvaluationCell';
import { RunEvaluationPlan } from '../application/RunEvaluationPlan';
import { CommandEvaluationTreatmentMaterializer } from '../infrastructure/CommandEvaluationTreatmentMaterializer';
import { FakeEvaluationAgent } from '../infrastructure/FakeEvaluationAgent';
import { FsRawCellStore } from '../infrastructure/FsRawCellStore';
import { JsonEvaluationPlanLoader } from '../infrastructure/JsonEvaluationPlanLoader';
import { Phase0EvaluationWorkspace } from '../infrastructure/Phase0EvaluationWorkspace';
import { Phase0RubricEvaluator } from '../infrastructure/Phase0RubricEvaluator';

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
  if (!planPath || !runDir || !['qualify', 'report', 'verify'].includes(command ?? '')) {
    io.stderr(
      'Usage: evaluation-cli <qualify|report|verify> --plan PLAN.json --run-dir DIR [--materializer FILE]\n',
    );
    return 1;
  }
  try {
    const plan = await new JsonEvaluationPlanLoader().load(planPath);
    const rubric = new Phase0RubricEvaluator({
      lockSha256: plan.corpus.lockSha256,
      atomicCatalogSha256: plan.corpus.atomicCatalogSha256,
    });
    const aggregate = new GenerateEvaluationAggregate(rubric);
    if (command === 'report') {
      const result = await aggregate.write(plan, runDir);
      io.stdout(`${JSON.stringify(result)}\n`);
      return 0;
    }
    if (command === 'verify') {
      const result = await aggregate.verify(plan, runDir);
      io.stdout(`${JSON.stringify(result)}\n`);
      return 0;
    }

    const store = new FsRawCellStore(runDir);
    const runCell = new RunEvaluationCell(
      new Phase0EvaluationWorkspace(),
      new CommandEvaluationTreatmentMaterializer(
        flag(rest, '--materializer') ?? path.resolve('benchmark/candidates/e13/materialize-candidate.mjs'),
      ),
      new FakeEvaluationAgent(plan.agent.command, plan.agent.args),
      rubric,
      store,
    );
    const records = await new RunEvaluationPlan(runCell, rubric, store).execute(plan);
    io.stdout(`${JSON.stringify({ runId: plan.runId, cells: records.length })}\n`);
    return 0;
  } catch (error) {
    io.stderr(`Evaluation failed: ${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
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
