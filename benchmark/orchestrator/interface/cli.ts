import { JsonPricingProvider } from '../infrastructure/JsonPricingProvider';
import { ScoreAdherence } from '../application/ScoreAdherence';
import { PrepareRun } from '../application/PrepareRun';
import { ResumeRun, type ResumeMode } from '../application/ResumeRun';
import { FsAdherenceArtifactWriter } from '../infrastructure/FsAdherenceArtifactWriter';
import { FsCheckpointStore } from '../infrastructure/FsCheckpointStore';
import { JsonAdherenceEvidenceProvider } from '../infrastructure/JsonAdherenceEvidenceProvider';
import { TaskManifestLoader } from '../infrastructure/TaskManifestLoader';

interface CliIo {
  stdout: (message: string) => void;
  stderr: (message: string) => void;
}

const defaultIo: CliIo = {
  stdout: (message) => process.stdout.write(message),
  stderr: (message) => process.stderr.write(message),
};

export async function runCli(args: string[], io: CliIo = defaultIo): Promise<number> {
  const [area, command, ...rest] = args;

  if (area === 'pricing' && command === 'validate') {
    return validatePricing(rest, io);
  }

  if (area === 'adherence' && command === 'score') {
    return scoreAdherence(rest, io);
  }

  if (area === 'run' && command === '--dry-run') {
    return dryRunBenchmark(rest, io);
  }

  io.stderr(
    [
      'Usage:',
      '  harness-bench pricing validate [--pricing benchmark/pricing/models.json]',
      '  harness-bench adherence score --evidence evidence.json --out adherence.json',
      '  harness-bench run --dry-run --run-id RUN --run-dir DIR [--manifest benchmark/tasks/manifest.json]',
      '  harness-bench run --dry-run --resume RUN --run-dir DIR [--only TASK|--from TASK|--steps T1,T2|--retry-failed] [--force]',
      '',
    ].join('\n'),
  );
  return 1;
}

async function dryRunBenchmark(args: string[], io: CliIo): Promise<number> {
  const resumeRunId = readFlag(args, '--resume');
  const runId = resumeRunId ?? readFlag(args, '--run-id');
  const runDir = readFlag(args, '--run-dir');
  const manifestPath = readFlag(args, '--manifest') ?? 'benchmark/tasks/manifest.json';
  const agent = readFlag(args, '--agent') ?? 'codex';
  const harnessRef = readFlag(args, '--harness') ?? 'main';
  const model = readFlag(args, '--model');
  const workspaceDir = readFlag(args, '--workspace') ?? process.cwd();

  if (!runId || !runDir) {
    io.stderr(
      'Usage: harness-bench run --dry-run (--run-id RUN|--resume RUN) --run-dir DIR [--manifest benchmark/tasks/manifest.json]\n',
    );
    return 1;
  }

  try {
    const checkpointStore = new FsCheckpointStore(runDir);
    const selector = resumeModeFromArgs(args, Boolean(resumeRunId));

    if (resumeRunId) {
      const state = await checkpointStore.load(resumeRunId);
      if (!state) {
        throw new Error(`state.json not found for run: ${resumeRunId}`);
      }

      const resumePlan = new ResumeRun().plan(state, selector ?? { kind: 'resume' });
      io.stdout(`Planned run ${resumePlan.runId}: ${resumePlan.steps.length} tasks\n`);
      for (const step of resumePlan.steps) {
        io.stdout(`- ${step.task}`);
        if (step.restoreCheckpoint) {
          io.stdout(` (restore ${step.restoreCheckpoint})`);
        }
        io.stdout('\n');
      }
      io.stdout(`State: ${runDir}/state.json\n`);
      return 0;
    }

    const plan = await new TaskManifestLoader(manifestPath).load(runId);
    const prepared = await new PrepareRun(checkpointStore).prepare(plan, {
      agent,
      model,
      harnessRef,
      workspaceDir,
    });

    if (selector) {
      const resumePlan = new ResumeRun().plan(prepared.state, selector);
      io.stdout(`Planned run ${resumePlan.runId}: ${resumePlan.steps.length} tasks\n`);
      for (const step of resumePlan.steps) {
        io.stdout(`- ${step.task}\n`);
      }
      io.stdout(`State: ${runDir}/state.json\n`);
      return 0;
    }

    io.stdout(`Prepared run ${prepared.state.runId}: ${prepared.taskIds.length} tasks\n`);
    for (const taskId of prepared.taskIds) {
      io.stdout(`- ${taskId}\n`);
    }
    io.stdout(`State: ${runDir}/state.json\n`);
    return 0;
  } catch (error) {
    io.stderr(`Dry run failed: ${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

function resumeModeFromArgs(args: string[], hasResume: boolean): ResumeMode | undefined {
  const only = readFlag(args, '--only');
  const from = readFlag(args, '--from');
  const steps = readFlag(args, '--steps');
  const retryFailed = hasFlag(args, '--retry-failed');
  const force = hasFlag(args, '--force');

  const selectors = [only, from, steps, retryFailed ? 'retry-failed' : undefined].filter(Boolean);
  if (selectors.length > 1) {
    throw new Error('choose only one resume selector: --only, --from, --steps, or --retry-failed');
  }

  if (only) {
    return { kind: 'only', task: only, force };
  }

  if (from) {
    return { kind: 'from', task: from };
  }

  if (steps) {
    return {
      kind: 'steps',
      tasks: steps
        .split(',')
        .map((task) => task.trim())
        .filter(Boolean),
      force,
    };
  }

  if (retryFailed) {
    return { kind: 'retry-failed' };
  }

  return hasResume ? { kind: 'resume' } : undefined;
}

async function validatePricing(args: string[], io: CliIo): Promise<number> {
  const pricingPath = readFlag(args, '--pricing') ?? 'benchmark/pricing/models.json';

  try {
    const provider = new JsonPricingProvider(pricingPath);
    const rates = await provider.allRates();
    io.stdout(`Pricing table OK: ${pricingPath}\n`);
    for (const rate of rates) {
      io.stdout(
        `${rate.model} (${rate.provider}) input=${rate.inputUsdPerMillion} cached=${rate.cachedInputUsdPerMillion} output=${rate.outputUsdPerMillion}\n`,
      );
    }
    return 0;
  } catch (error) {
    io.stderr(`Pricing table invalid: ${pricingPath}\n${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

async function scoreAdherence(args: string[], io: CliIo): Promise<number> {
  const evidencePath = readFlag(args, '--evidence');
  const outPath = readFlag(args, '--out');

  if (!evidencePath || !outPath) {
    io.stderr('Usage: harness-bench adherence score --evidence evidence.json --out adherence.json\n');
    return 1;
  }

  try {
    const score = await new ScoreAdherence(
      new JsonAdherenceEvidenceProvider(evidencePath),
      new FsAdherenceArtifactWriter(outPath),
    ).run();

    io.stdout(
      `Adherence scored: ${score.adherence_pass}/${score.adherence_total} -> ${outPath}\n`,
    );
    return 0;
  } catch (error) {
    io.stderr(
      `Adherence scoring failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    return 1;
  }
}

function readFlag(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index === -1) {
    return undefined;
  }

  return args[index + 1];
}

function hasFlag(args: string[], flag: string): boolean {
  return args.includes(flag);
}

if (require.main === module) {
  runCli(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
