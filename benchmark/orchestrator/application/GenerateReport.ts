import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { CheckpointState } from '../domain/checkpoint';

interface TimingJson {
  wall_seconds?: number;
}

interface TokensJson {
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
  estimated_cost_usd?: number | null;
}

interface UsageJson {
  interactions?: Array<{
    model?: string;
    inputTokens?: number;
    cachedInputTokens?: number;
    outputTokens?: number;
    costUsd?: number | null;
  }>;
  totals?: {
    inputTokens?: number;
    cachedInputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
    costUsd?: number | null;
  };
  pricingVersion?: string;
}

interface ChecksJson {
  checks?: Array<{ pass?: boolean }>;
}

interface QualityJson {
  trace_quality_score?: number;
}

interface LaneJson {
  expected?: string;
  actual?: string;
}

interface AdherenceJson {
  adherence_pass?: number;
  adherence_total?: number;
}

interface MetadataJson {
  harness_ref?: string;
  agent?: string;
  model?: string;
}

export interface ScoresJson {
  run_id: string;
  task_count: number;
  total_wall_seconds: number;
  total_input_tokens: number;
  total_output_tokens: number;
  total_tokens: number;
  estimated_total_cost_usd: number | null;
  functional_pass: number;
  functional_total: number;
  functional_pct: number;
  harness_pass: number;
  harness_total: number;
  harness_pct: number;
  avg_trace_quality: number;
  lane_accuracy: string;
  adherence_pass?: number;
  adherence_total?: number;
  adherence_pct?: number;
  pricing_version?: string;
  model_usage?: Record<string, ModelUsageScore>;
}

export interface ModelUsageScore {
  input_tokens: number;
  cached_input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  estimated_cost_usd: number | null;
}

interface TaskSummary {
  name: string;
  wallSeconds: number;
  inputTokens: number;
  outputTokens: number;
  tokens: number;
  costUsd: number | null;
  functionalPass: number;
  functionalTotal: number;
  harnessPass: number;
  harnessTotal: number;
  qualityScore: number;
  laneCorrect: boolean;
  adherencePass?: number;
  adherenceTotal?: number;
  pricingVersion?: string;
  modelUsage: Map<string, ModelUsageRollup>;
}

interface ModelUsageRollup {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  costUsd: number;
  hasUnknownCost: boolean;
}

export interface GeneratedReport {
  scores: ScoresJson;
  reportMarkdown: string;
}

export class GenerateReport {
  async generate(runId: string, runDir: string, generatedAt: Date = new Date()): Promise<GeneratedReport> {
    const taskNames = await this.discoverTaskNames(runDir);

    const tasks = await Promise.all(
      taskNames.map((taskName) => this.readTaskSummary(runDir, taskName)),
    );

    const scores = this.buildScores(runId, tasks);
    const metadata = await readJson<MetadataJson>(path.join(runDir, 'metadata.json'), {});
    const reportMarkdown = this.renderReport(runId, scores, tasks, metadata, generatedAt);

    return { scores, reportMarkdown };
  }

  renderScoresJson(scores: ScoresJson): string {
    return `{
  "run_id": "${scores.run_id}",
  "task_count": ${scores.task_count},
  "total_wall_seconds": ${scores.total_wall_seconds},
  "total_input_tokens": ${scores.total_input_tokens},
  "total_output_tokens": ${scores.total_output_tokens},
  "total_tokens": ${scores.total_tokens},
  "estimated_total_cost_usd": ${formatNullableNumber(scores.estimated_total_cost_usd)},
  "functional_pass": ${scores.functional_pass},
  "functional_total": ${scores.functional_total},
  "functional_pct": ${scores.functional_pct.toFixed(1)},
  "harness_pass": ${scores.harness_pass},
  "harness_total": ${scores.harness_total},
  "harness_pct": ${scores.harness_pct.toFixed(1)},
  "avg_trace_quality": ${scores.avg_trace_quality.toFixed(1)},
  "lane_accuracy": "${scores.lane_accuracy}"${renderOptionalScores(scores)}
}
`;
  }

  private async readTaskSummary(runDir: string, taskName: string): Promise<TaskSummary> {
    const taskDir = path.join(runDir, taskName);
    const timing = await readJson<TimingJson>(path.join(taskDir, 'timing.json'), {});
    const tokens = await readJson<TokensJson>(path.join(taskDir, 'tokens.json'), {});
    const usage = await readOptionalJson<UsageJson>(path.join(taskDir, 'usage.json'));
    const functional = await readJson<ChecksJson>(path.join(taskDir, 'functional.json'), {});
    const harness = await readJson<ChecksJson>(path.join(taskDir, 'harness.json'), {});
    const quality = await readJson<QualityJson>(path.join(taskDir, 'quality.json'), {});
    const lane = await readJson<LaneJson>(path.join(taskDir, 'lane.json'), {});
    const adherence = await readOptionalJson<AdherenceJson>(path.join(taskDir, 'adherence.json'));
    assertInteractionCostSum(usage, taskName);

    const functionalCounts = countChecks(functional);
    const harnessCounts = countChecks(harness);

    return {
      name: taskName,
      wallSeconds: timing.wall_seconds ?? 0,
      inputTokens:
        usage?.totals !== undefined
          ? (usage.totals.inputTokens ?? 0) + (usage.totals.cachedInputTokens ?? 0)
          : tokens.input_tokens ?? 0,
      outputTokens: usage?.totals?.outputTokens ?? tokens.output_tokens ?? 0,
      tokens: usage?.totals?.totalTokens ?? tokens.total_tokens ?? 0,
      costUsd:
        usage?.totals !== undefined
          ? usage.totals.costUsd ?? null
          : tokens.estimated_cost_usd === undefined
            ? 0
            : tokens.estimated_cost_usd,
      functionalPass: functionalCounts.pass,
      functionalTotal: functionalCounts.total,
      harnessPass: harnessCounts.pass,
      harnessTotal: harnessCounts.total,
      qualityScore: quality.trace_quality_score ?? 0,
      laneCorrect: lane.expected !== undefined && lane.actual !== undefined && lane.expected === lane.actual,
      adherencePass: adherence?.adherence_pass,
      adherenceTotal: adherence?.adherence_total,
      pricingVersion: usage?.pricingVersion,
      modelUsage: rollUpModelUsage(usage),
    };
  }

  private async discoverTaskNames(runDir: string): Promise<string[]> {
    const state = await readOptionalJson<CheckpointState>(path.join(runDir, 'state.json'));
    const artifactTaskNames = (await readdir(runDir, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && entry.name.startsWith('T'))
      .map((entry) => entry.name)
      .sort();

    if (!state) {
      return artifactTaskNames;
    }

    const ordered = state.steps.map((step) => step.task);
    const planned = new Set(ordered);
    return [...ordered, ...artifactTaskNames.filter((taskName) => !planned.has(taskName))];
  }

  private buildScores(runId: string, tasks: TaskSummary[]): ScoresJson {
    const totals = tasks.reduce(
      (acc, task) => {
        acc.wallSeconds += task.wallSeconds;
        acc.inputTokens += task.inputTokens;
        acc.outputTokens += task.outputTokens;
        if (task.costUsd === null) {
          acc.hasUnknownCost = true;
        } else {
          acc.costUsd += task.costUsd;
        }
        acc.functionalPass += task.functionalPass;
        acc.functionalTotal += task.functionalTotal;
        acc.harnessPass += task.harnessPass;
        acc.harnessTotal += task.harnessTotal;
        acc.qualityScore += task.qualityScore;
        acc.correctLanes += task.laneCorrect ? 1 : 0;
        if (task.adherencePass !== undefined && task.adherenceTotal !== undefined) {
          acc.adherencePass += task.adherencePass;
          acc.adherenceTotal += task.adherenceTotal;
          acc.hasAdherence = true;
        }
        if (task.pricingVersion) {
          acc.pricingVersions.add(task.pricingVersion);
        }
        for (const [model, usage] of task.modelUsage) {
          const current = acc.modelUsage.get(model) ?? emptyModelUsageRollup();
          current.inputTokens += usage.inputTokens;
          current.cachedInputTokens += usage.cachedInputTokens;
          current.outputTokens += usage.outputTokens;
          current.costUsd += usage.costUsd;
          current.hasUnknownCost ||= usage.hasUnknownCost;
          acc.modelUsage.set(model, current);
        }
        return acc;
      },
      {
        wallSeconds: 0,
        inputTokens: 0,
        outputTokens: 0,
        costUsd: 0,
        hasUnknownCost: false,
        functionalPass: 0,
        functionalTotal: 0,
        harnessPass: 0,
        harnessTotal: 0,
        qualityScore: 0,
        correctLanes: 0,
        adherencePass: 0,
        adherenceTotal: 0,
        hasAdherence: false,
        pricingVersions: new Set<string>(),
        modelUsage: new Map<string, ModelUsageRollup>(),
      },
    );

    const scores: ScoresJson = {
      run_id: runId,
      task_count: tasks.length,
      total_wall_seconds: totals.wallSeconds,
      total_input_tokens: totals.inputTokens,
      total_output_tokens: totals.outputTokens,
      total_tokens: totals.inputTokens + totals.outputTokens,
      estimated_total_cost_usd: totals.hasUnknownCost ? null : Number(totals.costUsd.toFixed(6)),
      functional_pass: totals.functionalPass,
      functional_total: totals.functionalTotal,
      functional_pct: pct(totals.functionalPass, totals.functionalTotal),
      harness_pass: totals.harnessPass,
      harness_total: totals.harnessTotal,
      harness_pct: pct(totals.harnessPass, totals.harnessTotal),
      avg_trace_quality: tasks.length > 0 ? truncate1(totals.qualityScore / tasks.length) : 0,
      lane_accuracy: `${totals.correctLanes}/${tasks.length}`,
    };

    if (totals.hasAdherence) {
      scores.adherence_pass = totals.adherencePass;
      scores.adherence_total = totals.adherenceTotal;
      scores.adherence_pct = pct(totals.adherencePass, totals.adherenceTotal);
    }

    if (totals.pricingVersions.size === 1) {
      scores.pricing_version = [...totals.pricingVersions][0];
    } else if (totals.pricingVersions.size > 1) {
      scores.pricing_version = 'mixed';
    }

    if (totals.modelUsage.size > 0) {
      scores.model_usage = renderModelUsageScores(totals.modelUsage);
    }

    return scores;
  }

  private renderReport(
    runId: string,
    scores: ScoresJson,
    tasks: TaskSummary[],
    metadata: MetadataJson,
    generatedAt: Date,
  ): string {
    const lines = [
      `# Benchmark Report: ${runId}`,
      '',
      `**Date**: ${formatDate(generatedAt)}`,
      `**Harness**: ${metadata.harness_ref ?? 'unknown'}`,
      `**Agent**: ${metadata.agent ?? 'unknown'}`,
      `**Model**: ${metadata.model ?? 'default'}`,
      '',
      '## Summary',
      '',
      '| Metric | Value |',
      '|--------|-------|',
      `| Total wall time | ${scores.total_wall_seconds}s (${truncate1(scores.total_wall_seconds / 60).toFixed(1)}m) |`,
      `| Total tokens | ${scores.total_tokens} (in: ${scores.total_input_tokens}, out: ${scores.total_output_tokens}) |`,
      `| Estimated cost | ${formatCost(scores.estimated_total_cost_usd)} |`,
      ...renderOptionalPricingReportRows(scores),
      `| Functional score | ${scores.functional_pass}/${scores.functional_total} (${scores.functional_pct.toFixed(1)}%) |`,
      `| Harness compliance | ${scores.harness_pass}/${scores.harness_total} (${scores.harness_pct.toFixed(1)}%) |`,
      `| Avg trace quality | ${scores.avg_trace_quality.toFixed(1)} / 3.0 |`,
      `| Lane accuracy | ${scores.lane_accuracy} |`,
      ...renderOptionalAdherenceReportRows(scores),
      '',
      '## Per-Task Results',
      '',
      '| Task | Time | Tokens | Functional | Harness | Quality |',
      '|------|------|--------|-----------|---------|---------|',
      ...tasks.map(
        (task) =>
          `| ${task.name} | ${task.wallSeconds}s | ${task.tokens} | ${task.functionalPass}/${task.functionalTotal} | ${task.harnessPass}/${task.harnessTotal} | ${task.qualityScore}/3 |`,
      ),
      ...renderOptionalModelUsageReport(scores),
      '',
      '---',
      '*Generated by harness-benchmark runner*',
      '',
    ];

    return lines.join('\n');
  }
}

async function readJson<T>(filePath: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(filePath, 'utf8')) as T;
  } catch {
    return fallback;
  }
}

async function readOptionalJson<T>(filePath: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(filePath, 'utf8')) as T;
  } catch {
    return undefined;
  }
}

function countChecks(json: ChecksJson): { pass: number; total: number } {
  const checks = json.checks ?? [];
  return {
    pass: checks.filter((check) => check.pass === true).length,
    total: checks.length,
  };
}

function pct(pass: number, total: number): number {
  if (total === 0) {
    return 0;
  }

  return truncate1((pass * 100) / total);
}

function rollUpModelUsage(usage: UsageJson | undefined): Map<string, ModelUsageRollup> {
  const rollup = new Map<string, ModelUsageRollup>();
  for (const interaction of usage?.interactions ?? []) {
    if (!interaction.model) {
      continue;
    }

    const current = rollup.get(interaction.model) ?? emptyModelUsageRollup();
    current.inputTokens += interaction.inputTokens ?? 0;
    current.cachedInputTokens += interaction.cachedInputTokens ?? 0;
    current.outputTokens += interaction.outputTokens ?? 0;
    if (interaction.costUsd === null || interaction.costUsd === undefined) {
      current.hasUnknownCost = true;
    } else {
      current.costUsd += interaction.costUsd;
    }
    rollup.set(interaction.model, current);
  }

  return rollup;
}

function emptyModelUsageRollup(): ModelUsageRollup {
  return {
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    costUsd: 0,
    hasUnknownCost: false,
  };
}

function renderModelUsageScores(
  modelUsage: Map<string, ModelUsageRollup>,
): Record<string, ModelUsageScore> {
  return Object.fromEntries(
    [...modelUsage.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([model, usage]) => [
        model,
        {
          input_tokens: usage.inputTokens,
          cached_input_tokens: usage.cachedInputTokens,
          output_tokens: usage.outputTokens,
          total_tokens: usage.inputTokens + usage.cachedInputTokens + usage.outputTokens,
          estimated_cost_usd: usage.hasUnknownCost ? null : Number(usage.costUsd.toFixed(8)),
        },
      ]),
  );
}

function assertInteractionCostSum(usage: UsageJson | undefined, taskName: string): void {
  const interactions = usage?.interactions ?? [];
  const totalCost = usage?.totals?.costUsd;
  if (totalCost === undefined || totalCost === null || interactions.length === 0) {
    return;
  }

  let sum = 0;
  for (const interaction of interactions) {
    if (interaction.costUsd === undefined || interaction.costUsd === null) {
      return;
    }
    sum += interaction.costUsd;
  }

  if (Number(sum.toFixed(8)) !== Number(totalCost.toFixed(8))) {
    throw new Error(`usage interaction costs do not sum to total for ${taskName}`);
  }
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : String(value);
}

function formatNullableNumber(value: number | null): string {
  return value === null ? 'null' : formatNumber(value);
}

function formatCost(value: number | null): string {
  return value === null ? 'unknown' : `$${formatNumber(value)}`;
}

function formatDate(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function truncate1(value: number): number {
  return Math.trunc(value * 10) / 10;
}

function renderOptionalScores(scores: ScoresJson): string {
  return [
    renderOptionalAdherenceScores(scores),
    renderOptionalPricingScores(scores),
    renderOptionalModelUsageScores(scores),
  ].join('');
}

function renderOptionalAdherenceScores(scores: ScoresJson): string {
  if (scores.adherence_pass === undefined || scores.adherence_total === undefined) {
    return '';
  }

  return `,
  "adherence_pass": ${scores.adherence_pass},
  "adherence_total": ${scores.adherence_total},
  "adherence_pct": ${(scores.adherence_pct ?? 0).toFixed(1)}`;
}

function renderOptionalPricingScores(scores: ScoresJson): string {
  if (!scores.pricing_version) {
    return '';
  }

  return `,
  "pricing_version": "${scores.pricing_version}"`;
}

function renderOptionalModelUsageScores(scores: ScoresJson): string {
  if (!scores.model_usage) {
    return '';
  }

  return `,
  "model_usage": ${JSON.stringify(scores.model_usage, null, 2).replace(/\n/g, '\n  ')}`;
}

function renderOptionalAdherenceReportRows(scores: ScoresJson): string[] {
  if (scores.adherence_pass === undefined || scores.adherence_total === undefined) {
    return [];
  }

  return [
    `| Harness adherence | ${scores.adherence_pass}/${scores.adherence_total} (${(scores.adherence_pct ?? 0).toFixed(1)}%) |`,
  ];
}

function renderOptionalPricingReportRows(scores: ScoresJson): string[] {
  if (!scores.pricing_version) {
    return [];
  }

  return [`| Pricing version | ${scores.pricing_version} |`];
}

function renderOptionalModelUsageReport(scores: ScoresJson): string[] {
  if (!scores.model_usage) {
    return [];
  }

  return [
    '',
    '## Per-Model Usage',
    '',
    '| Model | Tokens | Estimated cost |',
    '|-------|--------|----------------|',
    ...Object.entries(scores.model_usage).map(
      ([model, usage]) =>
        `| ${model} | ${usage.total_tokens} (in: ${usage.input_tokens + usage.cached_input_tokens}, out: ${usage.output_tokens}) | ${formatCost(usage.estimated_cost_usd)} |`,
    ),
  ];
}
