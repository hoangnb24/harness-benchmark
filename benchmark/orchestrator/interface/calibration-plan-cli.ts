#!/usr/bin/env node

import {
  buildCalibrationPlanCore,
  verifyCalibrationEvaluationPlanFile,
  writeCalibrationEvaluationPlan,
} from '../infrastructure/CalibrationPlanLock';

interface CliIo {
  stdout: (message: string) => void;
  stderr: (message: string) => void;
}

const defaultIo: CliIo = {
  stdout: (message) => process.stdout.write(message),
  stderr: (message) => process.stderr.write(message),
};

export async function runCalibrationPlanCli(args: string[], io: CliIo = defaultIo): Promise<number> {
  const [command, ...rest] = args;
  if (!['core', 'assemble', 'verify'].includes(command ?? '')) return usage(io);
  const governancePath = flag(rest, '--governance');
  const environmentBindingPath = flag(rest, '--environment');
  const pricingPolicyPath = flag(rest, '--pricing');
  const toolPolicyPath = flag(rest, '--tool-policy');
  if (!governancePath || !environmentBindingPath || !pricingPolicyPath || !toolPolicyPath) return usage(io);
  try {
    const built = await buildCalibrationPlanCore({
      governancePath,
      environmentBindingPath,
      pricingPolicyPath,
      toolPolicyPath,
    });
    if (command === 'core') {
      io.stdout(`${JSON.stringify({
        protocolId: built.governance.protocolId,
        executionCommit: built.governance.runner.executionCommit,
        semanticPlanSha256: built.semanticSha256,
        liveProviderCalls: 0,
      })}\n`);
      return 0;
    }
    const planPath = flag(rest, '--plan');
    if (!planPath) return usage(io);
    if (command === 'verify') {
      const plan = await verifyCalibrationEvaluationPlanFile(planPath, built);
      io.stdout(`${JSON.stringify({
        runId: plan.runId,
        executionCommit: plan.runner.commit,
        semanticPlanSha256: built.semanticSha256,
        status: 'exact-plan-verified',
        liveProviderCalls: 0,
      })}\n`);
      return 0;
    }
    const authorizationPath = flag(rest, '--authorization');
    const authorizationSha256 = flag(rest, '--authorization-sha');
    if (!authorizationPath || !authorizationSha256) return usage(io);
    const plan = await writeCalibrationEvaluationPlan(planPath, built, {
      path: authorizationPath,
      sha256: authorizationSha256,
    });
    io.stdout(`${JSON.stringify({
      runId: plan.runId,
      executionCommit: plan.runner.commit,
      semanticPlanSha256: built.semanticSha256,
      status: 'exact-plan-written',
      liveProviderCalls: 0,
    })}\n`);
    return 0;
  } catch (error) {
    io.stderr(`Calibration plan failed: ${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

function flag(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

function usage(io: CliIo): 1 {
  io.stderr('Usage: calibration-plan-cli <core|assemble|verify> --governance FILE --environment FILE --pricing FILE --tool-policy FILE [--plan FILE --authorization FILE --authorization-sha SHA256]\n');
  return 1;
}

if (require.main === module) {
  void runCalibrationPlanCli(process.argv.slice(2)).then((code) => { process.exitCode = code; });
}
