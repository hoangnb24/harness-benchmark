import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

interface TimingJson {
  wall_seconds?: number;
}

interface TokensJson {
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
  estimated_cost_usd?: number;
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
  estimated_total_cost_usd: number;
  functional_pass: number;
  functional_total: number;
  functional_pct: number;
  harness_pass: number;
  harness_total: number;
  harness_pct: number;
  avg_trace_quality: number;
  lane_accuracy: string;
}

interface TaskSummary {
  name: string;
  wallSeconds: number;
  inputTokens: number;
  outputTokens: number;
  tokens: number;
  costUsd: number;
  functionalPass: number;
  functionalTotal: number;
  harnessPass: number;
  harnessTotal: number;
  qualityScore: number;
  laneCorrect: boolean;
}

export interface GeneratedReport {
  scores: ScoresJson;
  reportMarkdown: string;
}

export class GenerateReport {
  async generate(runId: string, runDir: string, generatedAt: Date = new Date()): Promise<GeneratedReport> {
    const taskNames = (await readdir(runDir, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && entry.name.startsWith('T'))
      .map((entry) => entry.name)
      .sort();

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
  "estimated_total_cost_usd": ${formatNumber(scores.estimated_total_cost_usd)},
  "functional_pass": ${scores.functional_pass},
  "functional_total": ${scores.functional_total},
  "functional_pct": ${scores.functional_pct.toFixed(1)},
  "harness_pass": ${scores.harness_pass},
  "harness_total": ${scores.harness_total},
  "harness_pct": ${scores.harness_pct.toFixed(1)},
  "avg_trace_quality": ${scores.avg_trace_quality.toFixed(1)},
  "lane_accuracy": "${scores.lane_accuracy}"
}
`;
  }

  private async readTaskSummary(runDir: string, taskName: string): Promise<TaskSummary> {
    const taskDir = path.join(runDir, taskName);
    const timing = await readJson<TimingJson>(path.join(taskDir, 'timing.json'), {});
    const tokens = await readJson<TokensJson>(path.join(taskDir, 'tokens.json'), {});
    const functional = await readJson<ChecksJson>(path.join(taskDir, 'functional.json'), {});
    const harness = await readJson<ChecksJson>(path.join(taskDir, 'harness.json'), {});
    const quality = await readJson<QualityJson>(path.join(taskDir, 'quality.json'), {});
    const lane = await readJson<LaneJson>(path.join(taskDir, 'lane.json'), {});

    const functionalCounts = countChecks(functional);
    const harnessCounts = countChecks(harness);

    return {
      name: taskName,
      wallSeconds: timing.wall_seconds ?? 0,
      inputTokens: tokens.input_tokens ?? 0,
      outputTokens: tokens.output_tokens ?? 0,
      tokens: tokens.total_tokens ?? 0,
      costUsd: tokens.estimated_cost_usd ?? 0,
      functionalPass: functionalCounts.pass,
      functionalTotal: functionalCounts.total,
      harnessPass: harnessCounts.pass,
      harnessTotal: harnessCounts.total,
      qualityScore: quality.trace_quality_score ?? 0,
      laneCorrect: lane.expected === lane.actual,
    };
  }

  private buildScores(runId: string, tasks: TaskSummary[]): ScoresJson {
    const totals = tasks.reduce(
      (acc, task) => {
        acc.wallSeconds += task.wallSeconds;
        acc.inputTokens += task.inputTokens;
        acc.outputTokens += task.outputTokens;
        acc.costUsd += task.costUsd;
        acc.functionalPass += task.functionalPass;
        acc.functionalTotal += task.functionalTotal;
        acc.harnessPass += task.harnessPass;
        acc.harnessTotal += task.harnessTotal;
        acc.qualityScore += task.qualityScore;
        acc.correctLanes += task.laneCorrect ? 1 : 0;
        return acc;
      },
      {
        wallSeconds: 0,
        inputTokens: 0,
        outputTokens: 0,
        costUsd: 0,
        functionalPass: 0,
        functionalTotal: 0,
        harnessPass: 0,
        harnessTotal: 0,
        qualityScore: 0,
        correctLanes: 0,
      },
    );

    return {
      run_id: runId,
      task_count: tasks.length,
      total_wall_seconds: totals.wallSeconds,
      total_input_tokens: totals.inputTokens,
      total_output_tokens: totals.outputTokens,
      total_tokens: totals.inputTokens + totals.outputTokens,
      estimated_total_cost_usd: Number(totals.costUsd.toFixed(6)),
      functional_pass: totals.functionalPass,
      functional_total: totals.functionalTotal,
      functional_pct: pct(totals.functionalPass, totals.functionalTotal),
      harness_pass: totals.harnessPass,
      harness_total: totals.harnessTotal,
      harness_pct: pct(totals.harnessPass, totals.harnessTotal),
      avg_trace_quality: tasks.length > 0 ? truncate1(totals.qualityScore / tasks.length) : 0,
      lane_accuracy: `${totals.correctLanes}/${tasks.length}`,
    };
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
      `| Estimated cost | $${formatNumber(scores.estimated_total_cost_usd)} |`,
      `| Functional score | ${scores.functional_pass}/${scores.functional_total} (${scores.functional_pct.toFixed(1)}%) |`,
      `| Harness compliance | ${scores.harness_pass}/${scores.harness_total} (${scores.harness_pct.toFixed(1)}%) |`,
      `| Avg trace quality | ${scores.avg_trace_quality.toFixed(1)} / 3.0 |`,
      `| Lane accuracy | ${scores.lane_accuracy} |`,
      '',
      '## Per-Task Results',
      '',
      '| Task | Time | Tokens | Functional | Harness | Quality |',
      '|------|------|--------|-----------|---------|---------|',
      ...tasks.map(
        (task) =>
          `| ${task.name} | ${task.wallSeconds}s | ${task.tokens} | ${task.functionalPass}/${task.functionalTotal} | ${task.harnessPass}/${task.harnessTotal} | ${task.qualityScore}/3 |`,
      ),
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

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : String(value);
}

function formatDate(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function truncate1(value: number): number {
  return Math.trunc(value * 10) / 10;
}
