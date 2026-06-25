import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { JsonPricingProvider } from '../infrastructure/JsonPricingProvider';
import { BuildRunExecutionPlan } from '../application/BuildRunExecutionPlan';
import { ScoreAdherence } from '../application/ScoreAdherence';
import { GenerateReport } from '../application/GenerateReport';
import { PrepareRun } from '../application/PrepareRun';
import { ResumeRun, type ResumeMode } from '../application/ResumeRun';
import { buildRunner, type RunnerAgent } from './composition-root';
import { DeclarativeFunctionalProbe } from '../infrastructure/DeclarativeFunctionalProbe';
import { FetchHttpClient } from '../infrastructure/FetchHttpClient';
import type { CheckpointState } from '../domain/checkpoint';
import type { RunPlan } from '../domain/task';
import { FsAdherenceArtifactWriter } from '../infrastructure/FsAdherenceArtifactWriter';
import { FsCheckpointStore } from '../infrastructure/FsCheckpointStore';
import { CommandAdherenceEvidenceProvider } from '../infrastructure/CommandAdherenceEvidenceProvider';
import { JsonAdherenceEvidenceProvider } from '../infrastructure/JsonAdherenceEvidenceProvider';
import { NodeCommandRunner } from '../infrastructure/NodeCommandRunner';
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

  if (area === 'adherence' && command === 'collect') {
    return collectAdherence(rest, io);
  }

  if (area === 'report' && command === 'generate') {
    return generateReport(rest, io);
  }

  if (area === 'run' && command === '--dry-run') {
    return dryRunBenchmark(rest, io);
  }

  if (area === 'run' && command === '--execute') {
    return executeBenchmark(rest, io);
  }

  io.stderr(
    [
      'Usage:',
      '  harness-bench pricing validate [--pricing benchmark/pricing/models.json]',
      '  harness-bench adherence score --evidence evidence.json --out adherence.json',
      '  harness-bench adherence collect --cwd DIR --trace-id TRACE --out adherence.json [--log events.jsonl] [--allow-missing-commands]',
      '  harness-bench report generate --run-id RUN --run-dir DIR [--scores-out scores.json] [--report-out report.md]',
      '  harness-bench run --dry-run --run-id RUN --run-dir DIR [--manifest benchmark/tasks/manifest.json] [--pricing benchmark/pricing/models.json]',
      '  harness-bench run --execute --run-id RUN --run-dir DIR --workspace DIR [--agent codex|claude|custom] [--agent-cmd CMD]',
      '  harness-bench run --dry-run --resume RUN --run-dir DIR [--only TASK|--from TASK|--steps T1,T2|--retry-failed] [--force]',
      '',
    ].join('\n'),
  );
  return 1;
}

async function executeBenchmark(args: string[], io: CliIo): Promise<number> {
  const resumeRunId = readFlag(args, '--resume');
  const runId = resumeRunId ?? readFlag(args, '--run-id');
  const runDir = readFlag(args, '--run-dir');
  const workspaceDir = readFlag(args, '--workspace') ?? process.cwd();
  const manifestPath = readFlag(args, '--manifest') ?? 'benchmark/tasks/manifest.json';
  const agentValue = readFlag(args, '--agent') ?? 'codex';
  const model = readFlag(args, '--model');
  const pricingPath = readFlag(args, '--pricing') ?? 'benchmark/pricing/models.json';
  const checkpointStore = runDir ? new FsCheckpointStore(runDir) : undefined;

  if (!runId || !runDir || !checkpointStore) {
    io.stderr(
      'Usage: harness-bench run --execute (--run-id RUN|--resume RUN) --run-dir DIR --workspace DIR [--manifest benchmark/tasks/manifest.json]\n',
    );
    return 1;
  }

  try {
    const agent = readAgent(agentValue);
    const fullPlan = await new TaskManifestLoader(manifestPath).load(runId);
    const selector = resumeModeFromArgs(args, Boolean(resumeRunId));
    const { checkpointState, executionPlan } = await prepareExecutionPlan({
      checkpointStore,
      fullPlan,
      resumeRunId,
      selector,
      agent,
      model,
      harnessRef: readFlag(args, '--harness') ?? 'main',
      workspaceDir,
    });
    await validateRunPricing(checkpointState.model ?? model, args, io);

    await writeText(
      path.join(runDir, 'metadata.json'),
      `${JSON.stringify({ harness_ref: readFlag(args, '--harness') ?? 'main', agent, model }, null, 2)}\n`,
    );

    if (executionPlan.plan.tasks.length === 0) {
      io.stdout(`No tasks to run for ${runId}\n`);
    } else {
      const runner = buildRunner({
        agent,
        commandRunner: new NodeCommandRunner(),
        customCommand: readFlag(args, '--agent-cmd'),
        customArgs: readCsvFlag(args, '--agent-args'),
        functional: new DeclarativeFunctionalProbe({
          baseUrl: readFlag(args, '--base-url') ?? 'http://localhost:3000',
          http: new FetchHttpClient(),
        }),
        model,
        pricingPath,
        recordUsage: true,
        allowMissingPricing: hasFlag(args, '--allow-missing-pricing'),
        snapshotWorkspaces: true,
        checkpoints: checkpointStore,
      });

      const result = await runner.run(executionPlan.plan, {
        projectDir: workspaceDir,
        runDir,
        model,
        checkpointState,
        restoreCheckpoints: executionPlan.restoreCheckpoints,
      });
      io.stdout(`Executed run ${result.runId}: ${result.tasks.length} tasks\n`);
    }

    const generator = new GenerateReport();
    const report = await generator.generate(runId, runDir);
    await writeText(path.join(runDir, 'scores.json'), generator.renderScoresJson(report.scores));
    await writeText(path.join(runDir, 'report.md'), report.reportMarkdown);
    io.stdout(`Report generated: ${path.join(runDir, 'report.md')}\n`);
    return 0;
  } catch (error) {
    io.stderr(`Run failed: ${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

async function prepareExecutionPlan(options: {
  checkpointStore: FsCheckpointStore;
  fullPlan: RunPlan;
  resumeRunId: string | undefined;
  selector: ResumeMode | undefined;
  agent: RunnerAgent;
  model: string | undefined;
  harnessRef: string;
  workspaceDir: string;
}): Promise<{
  checkpointState: CheckpointState;
  executionPlan: { plan: RunPlan; restoreCheckpoints: Record<string, string> };
}> {
  if (options.resumeRunId) {
    const state = await options.checkpointStore.load(options.resumeRunId);
    if (!state) {
      throw new Error(`state.json not found for run: ${options.resumeRunId}`);
    }

    const resumePlan = new ResumeRun().plan(state, options.selector ?? { kind: 'resume' });
    return {
      checkpointState: state,
      executionPlan: new BuildRunExecutionPlan().fromResumePlan(options.fullPlan, resumePlan),
    };
  }

  const prepared = await new PrepareRun(options.checkpointStore).prepare(options.fullPlan, {
    agent: options.agent,
    model: options.model,
    harnessRef: options.harnessRef,
    workspaceDir: options.workspaceDir,
  });

  if (!options.selector) {
    return {
      checkpointState: prepared.state,
      executionPlan: { plan: options.fullPlan, restoreCheckpoints: {} },
    };
  }

  const resumePlan = new ResumeRun().plan(prepared.state, options.selector);
  return {
    checkpointState: prepared.state,
    executionPlan: new BuildRunExecutionPlan().fromResumePlan(options.fullPlan, resumePlan),
  };
}

async function collectAdherence(args: string[], io: CliIo): Promise<number> {
  const cwd = readFlag(args, '--cwd');
  const traceId = readFlag(args, '--trace-id');
  const outPath = readFlag(args, '--out');
  const requiredContextTier = Number(readFlag(args, '--required-context-tier') ?? '2');
  const maxEntropyScore = Number(readFlag(args, '--max-entropy-score') ?? '20');

  if (!cwd || !traceId || !outPath) {
    io.stderr(
      'Usage: harness-bench adherence collect --cwd DIR --trace-id TRACE --out adherence.json [--log events.jsonl] [--allow-missing-commands]\n',
    );
    return 1;
  }

  try {
    const score = await new ScoreAdherence(
      new CommandAdherenceEvidenceProvider(new NodeCommandRunner(), {
        cwd,
        traceId,
        requiredContextTier,
        maxEntropyScore,
        command: readFlag(args, '--command'),
        logPath: readFlag(args, '--log'),
        allowCommandFailures: hasFlag(args, '--allow-missing-commands'),
      }),
      new FsAdherenceArtifactWriter(outPath),
    ).run();

    io.stdout(
      `Adherence collected: ${score.adherence_pass}/${score.adherence_total} -> ${outPath}\n`,
    );
    return 0;
  } catch (error) {
    io.stderr(
      `Adherence collection failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    return 1;
  }
}

async function generateReport(args: string[], io: CliIo): Promise<number> {
  const runId = readFlag(args, '--run-id');
  const runDir = readFlag(args, '--run-dir');

  if (!runId || !runDir) {
    io.stderr(
      'Usage: harness-bench report generate --run-id RUN --run-dir DIR [--scores-out scores.json] [--report-out report.md]\n',
    );
    return 1;
  }

  const scoresOut = readFlag(args, '--scores-out') ?? path.join(runDir, 'scores.json');
  const reportOut = readFlag(args, '--report-out') ?? path.join(runDir, 'report.md');

  try {
    const generator = new GenerateReport();
    const generated = await generator.generate(runId, runDir);
    await writeText(scoresOut, generator.renderScoresJson(generated.scores));
    await writeText(reportOut, generated.reportMarkdown);

    io.stdout(`Report generated: ${scoresOut}\n`);
    io.stdout(`Markdown generated: ${reportOut}\n`);
    return 0;
  } catch (error) {
    io.stderr(
      `Report generation failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    return 1;
  }
}

async function writeText(filePath: string, contents: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, contents);
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

      await validateRunPricing(state.model ?? model, args, io);
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

    await validateRunPricing(model, args, io);
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

async function validateRunPricing(
  model: string | undefined,
  args: string[],
  io: CliIo,
): Promise<void> {
  if (!model) {
    return;
  }

  const pricingPath = readFlag(args, '--pricing') ?? 'benchmark/pricing/models.json';
  try {
    await new JsonPricingProvider(pricingPath).requireRate(model);
  } catch (error) {
    if (hasFlag(args, '--allow-missing-pricing')) {
      io.stderr(`Warning: missing pricing for model ${model}; cost will be recorded as null\n`);
      return;
    }

    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `${message}. Update ${pricingPath} or pass --allow-missing-pricing to continue with null cost.`,
    );
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

function readCsvFlag(args: string[], flag: string): string[] | undefined {
  const value = readFlag(args, flag);
  if (!value) {
    return undefined;
  }

  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function readAgent(value: string): RunnerAgent {
  if (value === 'codex' || value === 'claude' || value === 'custom') {
    return value;
  }

  throw new Error(`unknown agent: ${value}`);
}

function hasFlag(args: string[], flag: string): boolean {
  return args.includes(flag);
}

if (require.main === module) {
  runCli(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
