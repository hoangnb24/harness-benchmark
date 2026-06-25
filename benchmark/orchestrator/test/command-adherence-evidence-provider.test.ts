import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CommandAdherenceEvidenceProvider } from '../infrastructure/CommandAdherenceEvidenceProvider';
import type { CommandRunner } from '../infrastructure/LegacyCodexAdapter';

describe('CommandAdherenceEvidenceProvider', () => {
  it('collects Phase 5 review evidence from read-only harness commands', async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), 'adherence-provider-'));
    const logPath = path.join(cwd, 'events.jsonl');
    await writeFile(logPath, 'retry after timeout\n');
    const runner = new FixtureCommandRunner({
      'query tools --json': {
        tools: [
          {
            name: 'curl',
            responsibility: 'HTTP validation',
            verifyCommand: 'curl --version',
          },
        ],
      },
      'story verify-all --json': { ok: true, unverified_stories: 0 },
      'query interventions --json': { interventions: [{ traceId: 'trace-1', type: 'retry' }] },
      'score-context trace-1 --json': { tier: 2 },
      'audit --json': { entropy_score: 4 },
      'propose --json': {
        proposals: [
          {
            problem: 'Missing validation',
            evidence: 'trace:trace-1 friction:f1',
            suggested_change: 'Add a check',
            confidence: 0.8,
          },
        ],
      },
    });

    const evidence = await new CommandAdherenceEvidenceProvider(runner, {
      cwd,
      traceId: 'trace-1',
      requiredContextTier: 2,
      maxEntropyScore: 20,
      logPath,
    }).load();

    const commands = runner.calls.map((call) => call.args.join(' ')).sort();
    expect(commands).toEqual([
      'audit --json',
      'propose --json',
      'query interventions --json',
      'query tools --json',
      'score-context trace-1 --json',
      'story verify-all --json',
    ].sort());
    expect(evidence).toMatchObject({
      storyVerifyAll: { ok: true, unverifiedStories: 0 },
      logCorrectionPatterns: 2,
      contextTier: 2,
      entropyScore: 4,
      requiredContextTier: 2,
      maxEntropyScore: 20,
    });
    expect(evidence.tools).toHaveLength(1);
    expect(evidence.interventions).toHaveLength(1);
    expect(evidence.proposals).toHaveLength(1);
  });

  it('fails when a review command fails', async () => {
    const runner = new FixtureCommandRunner({}, new Set(['audit --json']));

    await expect(
      new CommandAdherenceEvidenceProvider(runner, {
        cwd: '/tmp/workspace',
        traceId: 'trace-1',
        requiredContextTier: 2,
        maxEntropyScore: 20,
      }).load(),
    ).rejects.toThrow(/adherence command failed \(audit\) with exit code 1/);
  });

  it('can degrade missing pre-Phase-5 commands into low evidence', async () => {
    const runner = new FixtureCommandRunner({}, new Set(['audit --json']));

    const evidence = await new CommandAdherenceEvidenceProvider(runner, {
      cwd: '/tmp/workspace',
      traceId: 'trace-1',
      requiredContextTier: 2,
      maxEntropyScore: 20,
      allowCommandFailures: true,
    }).load();

    expect(evidence).toMatchObject({
      tools: [],
      storyVerifyAll: { ok: false, unverifiedStories: 0 },
      contextTier: 0,
      entropyScore: 0,
      proposals: [],
    });
  });
});

class FixtureCommandRunner implements CommandRunner {
  readonly calls: Array<{ command: string; args: string[] }> = [];

  constructor(
    private readonly responses: Record<string, unknown>,
    private readonly failures = new Set<string>(),
  ) {}

  async run(
    command: string,
    args: string[],
    options: { cwd: string; stdinPath?: string; stdoutPath?: string; stderrPath?: string },
  ): Promise<{ exitCode: number }> {
    this.calls.push({ command, args });
    const key = args.join(' ');
    if (this.failures.has(key)) {
      return { exitCode: 1 };
    }

    if (options.stdoutPath) {
      await mkdir(path.dirname(options.stdoutPath), { recursive: true });
      await writeFile(options.stdoutPath, JSON.stringify(this.responses[key] ?? {}));
    }
    return { exitCode: 0 };
  }
}
