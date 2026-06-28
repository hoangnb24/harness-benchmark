import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AdherenceEvidence } from '../domain/adherence';
import type { AdherenceEvidenceProvider } from '../application/ScoreAdherence';
import type { CommandRunner } from './LegacyCodexAdapter';

export interface CommandAdherenceEvidenceOptions {
  cwd: string;
  traceId: string;
  requiredContextTier: number;
  maxEntropyScore: number;
  command?: string;
  logPath?: string;
  allowCommandFailures?: boolean;
}

export class CommandAdherenceEvidenceProvider implements AdherenceEvidenceProvider {
  constructor(
    private readonly runner: CommandRunner,
    private readonly options: CommandAdherenceEvidenceOptions,
  ) {}

  async load(): Promise<AdherenceEvidence> {
    const [tools, verifyAll, interventions, context, audit, proposals, logCorrectionPatterns] =
      await Promise.all([
        this.runJson('tools', ['query', 'tools', '--json']),
        this.runJson('verify-all', ['story', 'verify-all', '--json']),
        this.runJson('interventions', ['query', 'interventions', '--json']),
        this.runJson('score-context', ['score-context', this.options.traceId, '--json']),
        this.runJson('audit', ['audit', '--json']),
        this.runJson('propose', ['propose', '--json']),
        this.countLogCorrectionPatterns(),
      ]);

    return {
      tools: arrayFrom(tools, 'tools'),
      storyVerifyAll: {
        ok: booleanField(verifyAll, 'ok'),
        unverifiedStories: numberField(verifyAll, 'unverifiedStories', 'unverified_stories'),
      },
      logCorrectionPatterns,
      interventions: arrayFrom(interventions, 'interventions'),
      contextTier: numberField(context, 'contextTier', 'tier', 'context_tier'),
      requiredContextTier: this.options.requiredContextTier,
      entropyScore: numberField(audit, 'entropyScore', 'entropy_score'),
      maxEntropyScore: this.options.maxEntropyScore,
      proposals: arrayFrom(proposals, 'proposals'),
    };
  }

  private async runJson(label: string, args: string[]): Promise<unknown> {
    const dir = await mkdtemp(path.join(tmpdir(), `harness-adherence-${label}-`));
    const stdoutPath = path.join(dir, 'stdout.json');
    try {
      const result = await this.runner.run(this.options.command ?? 'harness-cli', args, {
        cwd: this.options.cwd,
        stdoutPath,
        stderrPath: path.join(dir, 'stderr.log'),
      });

      if (result.exitCode !== 0) {
        if (this.options.allowCommandFailures) {
          return {};
        }

        throw new Error(`adherence command failed (${label}) with exit code ${result.exitCode}`);
      }

      return JSON.parse(await readFile(stdoutPath, 'utf8')) as unknown;
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  private async countLogCorrectionPatterns(): Promise<number> {
    if (!this.options.logPath) {
      return 0;
    }

    const log = await readFile(this.options.logPath, 'utf8');
    return (log.match(/\b(correction|retry|failed|error|timeout)\b/gi) ?? []).length;
  }
}

function arrayFrom<T>(payload: unknown, key: string): T[] {
  if (Array.isArray(payload)) {
    return payload as T[];
  }

  if (isRecord(payload) && Array.isArray(payload[key])) {
    return payload[key] as T[];
  }

  return [];
}

function booleanField(payload: unknown, key: string): boolean {
  return isRecord(payload) && payload[key] === true;
}

function numberField(payload: unknown, ...keys: string[]): number {
  if (!isRecord(payload)) {
    return 0;
  }

  for (const key of keys) {
    const value = payload[key];
    if (typeof value === 'number') {
      return value;
    }
  }

  return 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
