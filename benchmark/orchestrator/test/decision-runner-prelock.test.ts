import { createHash } from 'node:crypto';
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CodexEvaluationAgent } from '../infrastructure/CodexEvaluationAgent';
import { BudgetedEvaluationAgent } from '../infrastructure/BudgetedEvaluationAgent';
import { codexExecutionPlanSha } from '../infrastructure/CodexExecutionAuthorization';
import type { EvaluationPlan } from '../domain/evaluation';
import type { EvaluationCellExecutor } from '../ports/EvaluationCellExecutor';
import { runEvaluationCli } from '../interface/evaluation-cli';

const roots: string[] = [];
const repositoryRoot = path.resolve('.');
const sourceRoot = path.resolve('../repository-harness');
const candidateRoot = path.join(
  sourceRoot,
  'docs/stories/epics/E13-phase-0-product-shape-evaluation/evidence/candidates',
);
const testPricing = {
  schemaVersion: 1 as const,
  model: 'gpt-test-offline',
  unit: 'credits-per-million-tokens' as const,
  rates: { input: 125, cachedInput: 12.5, output: 750 },
  source: 'offline-test-fixture',
  effectiveDate: '2026-07-14',
};
const testToolPolicy = {
  schemaVersion: 1 as const,
  codexVersion: '0.test-offline',
  allowedTools: ['shell', 'apply_patch'] as ['shell', 'apply_patch'],
  forbiddenCapabilities: [
    'connectors', 'mcp', 'subagents', 'browser', 'computer', 'image',
  ] as ['connectors', 'mcp', 'subagents', 'browser', 'computer', 'image'],
  featureOverrides: Object.fromEntries([
    'apps', 'auth_elicitation', 'browser_use', 'browser_use_external',
    'browser_use_full_cdp_access', 'computer_use', 'enable_fanout', 'enable_mcp_apps',
    'goals', 'image_generation', 'in_app_browser', 'multi_agent', 'plugins',
    'remote_plugin', 'skill_mcp_dependency_install', 'tool_call_mcp_elicitation',
  ].map((name) => [name, false])) as Record<string, false>,
  webSearch: 'disabled' as const,
  networkAccess: false as const,
};

afterEach(async () => {
  delete process.env.OPENAI_API_KEY;
  delete process.env.CODEX_HOME;
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('US-029 decision runner prelock', () => {
  it('selects the pinned Codex adapter and retains exact safe argv, cwd, env, JSONL, and usage', async () => {
    const root = await temporary();
    const runDir = path.join(root, 'run');
    const executable = path.join(root, 'codex-offline-stub.mjs');
    const invocationMarker = path.join(root, 'codex-invocations.jsonl');
    await executableFile(executable, [
      '#!/usr/bin/env node',
      "import {appendFileSync} from 'node:fs';",
      `appendFileSync(${JSON.stringify(invocationMarker)},JSON.stringify(process.argv.slice(2))+'\\n');`,
      "if(process.argv[2]==='--version'){process.stdout.write('codex-cli 0.test-offline\\n');process.exit(0)}",
      "if(process.argv[2]==='login'&&process.argv[3]==='status'){process.stdout.write('Logged in using ChatGPT\\n');process.exit(0)}",
      "import {mkdir,readFile,writeFile} from 'node:fs/promises';",
      "const args=process.argv.slice(2); const submission=args[args.indexOf('--add-dir')+1];",
      "const readme=await readFile('README.md','utf8'); await writeFile('README.md',readme.replace('npm start','npm run dev'));",
      "await mkdir(submission,{recursive:true}); await writeFile(`${submission}/proof.md`,'checked package.json\\n');",
      "process.stdout.write(JSON.stringify({type:'thread.started',argv:args,cwd:process.cwd(),env:process.env})+'\\n');",
      "process.stdout.write(JSON.stringify({type:'item.started',item:{id:'tool-1',type:'command_execution'}})+'\\n');",
      "process.stdout.write(JSON.stringify({type:'item.completed',item:{id:'tool-1',type:'command_execution'}})+'\\n');",
      "process.stdout.write(JSON.stringify({type:'item.completed',item:{id:'tool-1',type:'command_execution'}})+'\\n');",
      "process.stdout.write(JSON.stringify({type:'turn.completed',usage:{input_tokens:321,cached_input_tokens:21,output_tokens:45}})+'\\n');",
    ].join('\n'));
    process.env.OPENAI_API_KEY = 'must-not-leak';
    process.env.CODEX_HOME = '/mutable/user/config';
    const planPath = await atomicCodexPlan(root, executable, runDir);
    const authorizationSha = JSON.parse(await readFile(planPath, 'utf8')).agent.authorization.sha256;

    expect(await runEvaluationCli([
      'qualify', '--plan', planPath, '--run-dir', runDir,
      '--allow-live-codex', '--approved-authorization-sha', authorizationSha,
    ], quiet())).toBe(0);
    expect(await runEvaluationCli(['report', '--plan', planPath, '--run-dir', runDir], quiet())).toBe(0);
    expect(await runEvaluationCli(['verify', '--plan', planPath, '--run-dir', runDir], quiet())).toBe(0);
    const record = JSON.parse(await readFile(path.join(runDir, 'cells/codex-contract.json'), 'utf8'));
    const raw = await readFile(path.join(runDir, 'evidence/codex-contract/stdout.bin'), 'utf8');
    const events = raw.trim().split('\n').map((line) => JSON.parse(line));
    const workspace = events[0].argv[events[0].argv.indexOf('-C') + 1];
    const submission = events[0].argv.at(-1);
    expect(events[0].argv).toEqual([
      'exec', '--json', '--ephemeral', '--ignore-user-config', '--strict-config',
      '--model', 'gpt-test-offline',
      '-c', 'model_reasoning_effort="max"',
      '-c', 'approval_policy="never"',
      '-c', 'features.apps=false',
      '-c', 'features.auth_elicitation=false',
      '-c', 'features.browser_use=false',
      '-c', 'features.browser_use_external=false',
      '-c', 'features.browser_use_full_cdp_access=false',
      '-c', 'features.computer_use=false',
      '-c', 'features.enable_fanout=false',
      '-c', 'features.enable_mcp_apps=false',
      '-c', 'features.goals=false',
      '-c', 'features.image_generation=false',
      '-c', 'features.in_app_browser=false',
      '-c', 'features.multi_agent=false',
      '-c', 'features.plugins=false',
      '-c', 'features.remote_plugin=false',
      '-c', 'features.skill_mcp_dependency_install=false',
      '-c', 'features.tool_call_mcp_elicitation=false',
      '-c', 'sandbox_workspace_write.network_access=false',
      '-c', 'web_search="disabled"',
      '--sandbox', 'workspace-write', '-C', workspace, '--add-dir', submission,
    ]);
    expect(events[0].cwd.replace(/^\/private(?=\/var\/)/, '')).toBe(workspace);
    const { __CF_USER_TEXT_ENCODING: macOsInjectedEncoding, ...controlledEnvironment } = events[0].env;
    expect(controlledEnvironment).toEqual(expectedCodexEnvironment());
    if (process.platform === 'darwin') expect(macOsInjectedEncoding).toMatch(/^0x[0-9A-F]+:/);
    expect(events[0].env).not.toHaveProperty('OPENAI_API_KEY');
    expect(events[0].env).not.toHaveProperty('CODEX_HOME');
    expect(record).toMatchObject({
      status: 'passed',
      metrics: {
        inputTokens: { status: 'known', value: 321 },
        cachedInputTokens: { status: 'known', value: 21 },
        outputTokens: { status: 'known', value: 45 },
        toolLoops: { status: 'known', value: 1 },
        consumedPlanCredits: { status: 'known' },
        costUsd: { status: 'unknown' },
      },
      process: { signal: null },
    });
    expect(raw).toContain('"type":"thread.started"');
    expect(raw).toContain('"type":"turn.completed"');
    const metrics = JSON.parse(await readFile(path.join(runDir, 'evidence/codex-contract/metrics-receipt.json'), 'utf8'));
    expect(metrics.values).toEqual({
      inputTokens: 321,
      cachedInputTokens: 21,
      outputTokens: 45,
      toolLoops: 1,
      consumedPlanCredits: ((300 * 125) + (21 * 12.5) + (45 * 750)) / 1_000_000,
      costUsd: null,
    });
    expect(metrics.measurements).toMatchObject({
      cachedInputTokens: { status: 'known', value: 21 },
      toolLoops: { status: 'known', value: 1 },
      consumedPlanCredits: { status: 'known' },
      costUsd: { status: 'unknown' },
    });
    expect((await readFile(invocationMarker, 'utf8')).trim().split('\n')).toHaveLength(3);
  }, 30_000);

  it('rejects missing, tampered, mismatched, or non-approved authorization before any Codex launch', async () => {
    for (const variant of [
      'missing-live-flag', 'missing-external-hash', 'external-hash-mismatch',
      'missing', 'tampered', 'wrong-run', 'wrong-model', 'non-approved', 'tampered-protocol',
      'rejects-one-call-credit-overshoot',
      'tampered-tool-policy', 'tampered-executable', 'nonempty-run-dir', 'symlink-parent',
      'unsafe-id', 'later-treatment-mismatch',
    ] as const) {
      const root = await temporary();
      const executable = path.join(root, 'must-not-launch.mjs');
      const marker = path.join(root, 'invoked.txt');
      await executableFile(executable, [
        '#!/usr/bin/env node',
        "import {appendFileSync} from 'node:fs';",
        `appendFileSync(${JSON.stringify(marker)},'invoked\\n');`,
        "if(process.argv[2]==='--version')process.stdout.write('codex-cli 0.test-offline\\n');",
        "if(process.argv[2]==='login'&&process.argv[3]==='status')process.stdout.write('Logged in using ChatGPT\\n');",
      ].join('\n'));
      let runPath = path.join(root, 'run');
      if (variant === 'symlink-parent') {
        const actualParent = path.join(root, 'actual-parent');
        const linkedParent = path.join(root, 'linked-parent');
        await mkdir(actualParent);
        await symlink(actualParent, linkedParent, 'dir');
        runPath = path.join(linkedParent, 'run');
      }
      const planPath = await atomicCodexPlan(root, executable, runPath);
      const plan = JSON.parse(await readFile(planPath, 'utf8'));
      const authorizationPath = plan.agent.authorization.path;
      const protocolPath = plan.agent.protocol.path;
      const toolPolicyPath = plan.agent.toolPolicy.path;
      const approvedSha = plan.agent.authorization.sha256;
      let externalSha = approvedSha;
      if (variant === 'missing') {
        delete plan.agent.authorization;
        await writeFile(planPath, JSON.stringify(plan, null, 2));
      } else if (variant === 'tampered') {
        await writeFile(authorizationPath, `${await readFile(authorizationPath, 'utf8')} `);
      } else if (variant === 'tampered-protocol') {
        await writeFile(protocolPath, `${await readFile(protocolPath, 'utf8')} `);
      } else if (variant === 'tampered-tool-policy') {
        await writeFile(toolPolicyPath, `${await readFile(toolPolicyPath, 'utf8')} `);
      } else if (variant === 'tampered-executable') {
        await writeFile(executable, `${await readFile(executable, 'utf8')}\n// tampered`);
      } else {
        const authorization = JSON.parse(await readFile(authorizationPath, 'utf8'));
        if (variant === 'wrong-run') authorization.runId = 'another-run';
        if (variant === 'wrong-model') authorization.model = 'another-model';
        if (variant === 'non-approved') authorization.state = 'pending';
        if (variant === 'rejects-one-call-credit-overshoot') {
          authorization.acceptsPossibleOneAdmittedCallCreditOvershoot = false;
        }
        await writeFile(authorizationPath, JSON.stringify(authorization, null, 2));
        plan.agent.authorization.sha256 = await fileSha(authorizationPath);
        externalSha = plan.agent.authorization.sha256;
        await writeFile(planPath, JSON.stringify(plan, null, 2));
      }
      if (variant === 'unsafe-id') {
        plan.cells[0].id = '../unsafe';
        await writeFile(planPath, JSON.stringify(plan, null, 2));
      }
      if (variant === 'later-treatment-mismatch') {
        plan.cells.push({
          ...structuredClone(plan.cells[0]),
          id: 'later-cell',
          order: { repetition: 0, position: 1 },
          treatment: { ...plan.cells[0].treatment, sha256: sha('wrong-treatment') },
        });
        await writeFile(planPath, JSON.stringify(plan, null, 2));
      }
      if (variant === 'nonempty-run-dir') {
        await mkdir(runPath);
        await writeFile(path.join(runPath, 'partial.json'), '{}');
      }
      const cliArgs = [
        'qualify', '--plan', planPath, '--run-dir', runPath,
        '--allow-live-codex', '--approved-authorization-sha', externalSha,
      ];
      if (variant === 'missing-live-flag') cliArgs.splice(cliArgs.indexOf('--allow-live-codex'), 1);
      if (variant === 'missing-external-hash') {
        cliArgs.splice(cliArgs.indexOf('--approved-authorization-sha'), 2);
      }
      if (variant === 'external-hash-mismatch') cliArgs[cliArgs.length - 1] = sha('another-approval');
      expect(
        await runEvaluationCli(cliArgs, quiet()),
        variant,
      ).toBe(1);
      await expect(stat(marker), variant).rejects.toThrow();
    }
  });

  it('keeps missing Codex usage unknown rather than converting it to zero', async () => {
    const root = await temporary();
    const executable = path.join(root, 'codex-no-usage.mjs');
    await executableFile(executable, "#!/usr/bin/env node\nif(process.argv[2]==='--version'){process.stdout.write('codex-cli 0.test-offline\\n');process.exit(0)}\nif(process.argv[2]==='login'&&process.argv[3]==='status'){process.stdout.write('Logged in using ChatGPT\\n');process.exit(0)}\nprocess.stdout.write('{\"type\":\"turn.completed\"}\\n');\n");
    const workspaceDir = path.join(root, 'workspace');
    const submissionDir = path.join(root, 'submission');
    await Promise.all([writeFile(path.join(root, 'placeholder'), ''), rm(workspaceDir, { recursive: true, force: true })]);
    const { mkdir } = await import('node:fs/promises');
    await Promise.all([mkdir(workspaceDir), mkdir(submissionDir)]);
    await expect(new CodexEvaluationAgent(
      { path: executable, sha256: shaFileSync(executable), version: 'wrong-version' },
      'gpt-test-offline',
      'max',
      testPricing,
      sha('offline-pricing-policy'),
      testToolPolicy,
      sha('offline-tool-policy'),
    ).execute({ cell: cell('version-mismatch', 2), workspaceDir, submissionDir, prompt: 'offline' }))
      .rejects.toThrow('version mismatch');
    const result = await adapter(executable).execute({
      cell: cell('missing-usage', 2), workspaceDir, submissionDir, prompt: 'offline',
    });
    expect(result.inputTokens).toMatchObject({ status: 'unknown' });
    expect(result.outputTokens).toMatchObject({ status: 'unknown' });
    expect(result.cachedInputTokens).toMatchObject({ status: 'unknown' });
    expect(result.toolLoops).toEqual({ status: 'known', value: 0 });
    expect(result.consumedPlanCredits).toMatchObject({ status: 'unknown' });
    expect(result.costUsd).toMatchObject({ status: 'unknown' });

    const incomplete = path.join(root, 'codex-incomplete-jsonl.mjs');
    await executableFile(incomplete, "#!/usr/bin/env node\nif(process.argv[2]==='--version'){process.stdout.write('codex-cli 0.test-offline\\n');process.exit(0)}\nif(process.argv[2]==='login'&&process.argv[3]==='status'){process.stdout.write('Logged in using ChatGPT\\n');process.exit(0)}\nprocess.stdout.write('{malformed\\n');\n");
    const incompleteResult = await adapter(incomplete).execute({
      cell: cell('incomplete-jsonl', 2), workspaceDir, submissionDir, prompt: 'offline',
    });
    expect(incompleteResult.toolLoops).toMatchObject({ status: 'unknown' });

    const partialUsage = path.join(root, 'codex-partial-usage.mjs');
    await executableFile(partialUsage, [
      '#!/usr/bin/env node',
      "if(process.argv[2]==='--version'){process.stdout.write('codex-cli 0.test-offline\\n');process.exit(0)}",
      "if(process.argv[2]==='login'&&process.argv[3]==='status'){process.stdout.write('Logged in using ChatGPT\\n');process.exit(0)}",
      "process.stdout.write(JSON.stringify({type:'turn.failed',usage:{input_tokens:1,cached_input_tokens:0,output_tokens:1}})+'\\n');",
      'process.exitCode=7;',
    ].join('\n'));
    const partialResult = await adapter(partialUsage).execute({
      cell: cell('partial-usage', 2), workspaceDir, submissionDir, prompt: 'offline',
    });
    expect(partialResult.exitCode).toBe(7);
    expect(partialResult.inputTokens).toMatchObject({ status: 'unknown' });
    expect(partialResult.consumedPlanCredits).toMatchObject({ status: 'unknown' });

    const apiAuth = path.join(root, 'codex-api-auth.mjs');
    await executableFile(apiAuth, "#!/usr/bin/env node\nif(process.argv[2]==='--version'){process.stdout.write('codex-cli 0.test-offline\\n');process.exit(0)}\nif(process.argv[2]==='login'&&process.argv[3]==='status'){process.stdout.write('Logged in using API Key\\n');process.exit(0)}\n");
    await expect(adapter(apiAuth).execute({
      cell: cell('api-auth-rejected', 2), workspaceDir, submissionDir, prompt: 'offline',
    })).rejects.toThrow('not authenticated with the approved ChatGPT plan mode');

    const slowPreflight = path.join(root, 'codex-slow-preflight.mjs');
    await executableFile(slowPreflight, [
      '#!/usr/bin/env node',
      "if(process.argv[2]==='--version'){process.stdout.write('codex-cli 0.test-offline\\n')} ",
      "else if(process.argv[2]==='login'&&process.argv[3]==='status'){setTimeout(()=>process.stdout.write('Logged in using ChatGPT\\n'),5000)}",
      "else process.stdout.write(JSON.stringify({type:'turn.completed',usage:{input_tokens:1,cached_input_tokens:0,output_tokens:1}})+'\\n');",
    ].join('\n'));
    const budgetStartedAt = Date.now();
    await expect(new CodexEvaluationAgent(
      { path: slowPreflight, sha256: shaFileSync(slowPreflight), version: '0.test-offline' },
      'gpt-test-offline',
      'max',
      testPricing,
      sha('offline-pricing-policy'),
      testToolPolicy,
      sha('offline-tool-policy'),
      1,
      budgetStartedAt,
    ).execute({ cell: cell('slow-preflight', 5), workspaceDir, submissionDir, prompt: 'offline' }))
      .rejects.toThrow('not authenticated with the approved ChatGPT plan mode');

    const forbiddenTool = path.join(root, 'codex-forbidden-tool.mjs');
    await executableFile(forbiddenTool, [
      '#!/usr/bin/env node',
      "if(process.argv[2]==='--version'){process.stdout.write('codex-cli 0.test-offline\\n');process.exit(0)}",
      "if(process.argv[2]==='login'&&process.argv[3]==='status'){process.stdout.write('Logged in using ChatGPT\\n');process.exit(0)}",
      "process.stdout.write(JSON.stringify({type:'item.completed',item:{id:'mcp-1',type:'mcp_tool_call'}})+'\\n');",
      "process.stdout.write(JSON.stringify({type:'turn.completed',usage:{input_tokens:10,cached_input_tokens:0,output_tokens:1}})+'\\n');",
    ].join('\n'));
    const forbiddenResult = await adapter(forbiddenTool).execute({
      cell: cell('forbidden-tool', 2), workspaceDir, submissionDir, prompt: 'offline',
    });
    expect(forbiddenResult.exitCode).toBe(126);
    expect(forbiddenResult.stderr.toString('utf8')).toContain('mcp_tool_call');
  });

  it('enforces shared invocation, elapsed-time, and plan-credit admission limits', async () => {
    const observedTimeouts: number[] = [];
    let returnedCredits = 0.7;
    const delegate: EvaluationCellExecutor = {
      async execute(input) {
        observedTimeouts.push(input.cell.timeoutSeconds);
        return {
          exitCode: 0, signal: null, timedOut: false,
          stdout: Buffer.alloc(0), stderr: Buffer.alloc(0), wallMilliseconds: 1,
          inputTokens: { status: 'known', value: 1 },
          cachedInputTokens: { status: 'known', value: 0 },
          outputTokens: { status: 'known', value: 1 },
          toolLoops: { status: 'known', value: 0 },
          consumedPlanCredits: { status: 'known', value: returnedCredits },
          costUsd: { status: 'unknown', reason: 'offline' },
          metricsReceipt: Buffer.from('{}'),
        };
      },
    };
    const budgeted = new BudgetedEvaluationAgent(delegate, {
      maxInvocations: 2, maxPlanCredits: 1, maxElapsedSeconds: 1, perInvocationCreditReserve: 0.4,
    });
    const input = {
      cell: cell('budget', 20), workspaceDir: '/tmp/offline', submissionDir: '/tmp/offline-proof', prompt: 'offline',
    };
    expect((await budgeted.execute(input)).exitCode).toBe(0);
    await expect(budgeted.execute(input)).rejects.toThrow('credit reserve');
    expect(observedTimeouts[0]).toBeLessThanOrEqual(1);

    returnedCredits = 1.2;
    const crossing = new BudgetedEvaluationAgent(delegate, {
      maxInvocations: 2, maxPlanCredits: 1, maxElapsedSeconds: 60, perInvocationCreditReserve: 0.1,
    });
    expect((await crossing.execute(input)).exitCode).toBe(125);
    await expect(crossing.execute(input)).rejects.toThrow('observed plan-credit ceiling was crossed');
  });

  it('reports signals and kills the whole Codex stub process group on timeout', async () => {
    const root = await temporary();
    const signalStub = path.join(root, 'codex-signal.mjs');
    await executableFile(signalStub, "#!/usr/bin/env node\nif(process.argv[2]==='--version'){process.stdout.write('codex-cli 0.test-offline\\n');process.exit(0)}\nif(process.argv[2]==='login'&&process.argv[3]==='status'){process.stdout.write('Logged in using ChatGPT\\n');process.exit(0)}\nprocess.kill(process.pid,'SIGTERM');\n");
    const workspaceDir = path.join(root, 'signal-workspace');
    const submissionDir = path.join(root, 'signal-submission');
    const { mkdir } = await import('node:fs/promises');
    await Promise.all([mkdir(workspaceDir), mkdir(submissionDir)]);
    const signalled = await adapter(signalStub).execute({
      cell: cell('signal', 2), workspaceDir, submissionDir, prompt: 'offline',
    });
    expect(signalled).toMatchObject({ signal: 'SIGTERM', exitCode: 143, timedOut: false });

    const marker = path.join(root, 'descendant-leak.txt');
    const timeoutStub = path.join(root, 'codex-timeout.mjs');
    await executableFile(timeoutStub, [
      '#!/usr/bin/env node',
      "if(process.argv[2]==='--version'){process.stdout.write('codex-cli 0.test-offline\\n');process.exit(0)}",
      "if(process.argv[2]==='login'&&process.argv[3]==='status'){process.stdout.write('Logged in using ChatGPT\\n');process.exit(0)}",
      "import {spawn} from 'node:child_process';",
      `spawn(process.execPath,['-e',${JSON.stringify(`setTimeout(()=>require('fs').writeFileSync(${JSON.stringify(marker)},'leak'),500)`) }],{stdio:'ignore'});`,
      'setTimeout(()=>{},10000);',
    ].join('\n'));
    const timedOut = await adapter(timeoutStub).execute({
      cell: cell('timeout', 0.1), workspaceDir, submissionDir, prompt: 'offline',
    });
    expect(timedOut).toMatchObject({ exitCode: 124, timedOut: true });
    await new Promise((resolve) => setTimeout(resolve, 700));
    await expect(stat(marker)).rejects.toThrow();
  });

  it('runs S01 to S03 in one treated workspace and excludes the journey from atomic aggregation', async () => {
    const root = await temporary();
    const runDir = path.join(root, 'run');
    const fake = path.join(root, 'cumulative-pass.mjs');
    await writeFile(fake, cumulativeAgent(false));
    const planPath = await cumulativePlan(root, fake, ['journey-positive']);

    expect(await runEvaluationCli(['qualify', '--plan', planPath, '--run-dir', runDir], quiet())).toBe(0);
    const record = JSON.parse(await readFile(path.join(runDir, 'cumulative/journeys/journey-positive.json'), 'utf8'));
    const aggregate = JSON.parse(await readFile(path.join(runDir, 'cumulative/aggregate.json'), 'utf8'));
    expect(record.treatmentApplicationCount).toBe(1);
    expect(record.steps.map((step: { status: string }) => step.status)).toEqual(['passed', 'passed', 'passed']);
    expect(record.steps[1].workspace.beforeSha256).toBe(record.steps[0].workspace.afterSha256);
    expect(record.steps[2].workspace.beforeSha256).toBe(record.steps[1].workspace.afterSha256);
    expect(record.workspace.disposed).toBe(true);
    expect(aggregate).toMatchObject({
      separateAnalysis: true,
      excludedFromAtomicPrimaryAggregate: true,
      journeyCount: 1,
      stepPass: 3,
      stepTotal: 3,
      expectedJourneyRunIds: ['journey-positive'],
    });
    expect(aggregate.sourceJourneys).toHaveLength(1);
    await expect(readFile(path.join(runDir, 'aggregate.json'))).rejects.toThrow();
    for (const step of record.steps) {
      if (step.status === 'passed') {
        await expect(readFile(path.join(runDir, step.evidence.stdoutJsonl.path))).resolves.toBeDefined();
      }
    }
    expect(await runEvaluationCli(['verify', '--plan', planPath, '--run-dir', runDir], quiet())).toBe(0);
    const recordPath = path.join(runDir, 'cumulative/journeys/journey-positive.json');
    const originalRecordBytes = await readFile(recordPath);
    const inconsistent = JSON.parse(originalRecordBytes.toString('utf8'));
    inconsistent.steps[0].rubric.observed[0].pass = false;
    await writeFile(recordPath, JSON.stringify(inconsistent, null, 2));
    expect(await runEvaluationCli(['verify', '--plan', planPath, '--run-dir', runDir], quiet())).toBe(1);
    await writeFile(recordPath, originalRecordBytes);
    await writeFile(path.join(runDir, record.steps[0].evidence.stdoutJsonl.path), 'tampered');
    expect(await runEvaluationCli(['verify', '--plan', planPath, '--run-dir', runDir], quiet())).toBe(1);
  }, 30_000);

  it('blocks downstream steps after failure without reapplying treatment', async () => {
    const root = await temporary();
    const runDir = path.join(root, 'run');
    const fake = path.join(root, 'cumulative-fail.mjs');
    await writeFile(fake, cumulativeAgent(true));
    const planPath = await cumulativePlan(root, fake, ['journey-failure']);

    expect(await runEvaluationCli(['qualify', '--plan', planPath, '--run-dir', runDir], quiet())).toBe(0);
    const record = JSON.parse(await readFile(path.join(runDir, 'cumulative/journeys/journey-failure.json'), 'utf8'));
    expect(record.treatmentApplicationCount).toBe(1);
    expect(record.steps.map((step: { status: string }) => step.status)).toEqual([
      'failed', 'blocked_dependency', 'blocked_dependency',
    ]);
    expect(record.steps[1].blockedBy).toEqual(['P0-J01-S01-doc']);
    expect(record.steps[2].blockedBy).toEqual(['P0-J01-S01-doc', 'P0-J01-S02-retry']);
    expect(record.steps[1].evidence).toEqual({});
    expect(record.workspace.disposed).toBe(true);
  }, 30_000);

  it('uses a fresh isolated workspace for each cumulative journey run', async () => {
    const root = await temporary();
    const runDir = path.join(root, 'run');
    const fake = path.join(root, 'cumulative-isolation.mjs');
    await writeFile(fake, cumulativeAgent(false, true));
    const planPath = await cumulativePlan(root, fake, ['journey-one', 'journey-two']);

    expect(await runEvaluationCli(['qualify', '--plan', planPath, '--run-dir', runDir], quiet())).toBe(0);
    const first = JSON.parse(await readFile(path.join(runDir, 'cumulative/journeys/journey-one.json'), 'utf8'));
    const second = JSON.parse(await readFile(path.join(runDir, 'cumulative/journeys/journey-two.json'), 'utf8'));
    expect(first.steps.every((step: { status: string }) => step.status === 'passed')).toBe(true);
    expect(second.steps.every((step: { status: string }) => step.status === 'passed')).toBe(true);
    expect(first.steps[0].workspace.beforeSha256).toBe(second.steps[0].workspace.beforeSha256);
    expect(first.workspace.disposed).toBe(true);
    expect(second.workspace.disposed).toBe(true);
  }, 30_000);
});

async function atomicCodexPlan(root: string, executable: string, runDirectory: string): Promise<string> {
  const corpusRoot = path.join(repositoryRoot, 'benchmark/phase0');
  const manifestPath = path.join(candidateRoot, 'copy-once.json');
  const protocolPath = path.join(root, 'approved-protocol.json');
  await writeFile(protocolPath, JSON.stringify({ schemaVersion: 1, protocolId: 'offline-test' }, null, 2));
  const protocolSha256 = await fileSha(protocolPath);
  const executableSha256 = await fileSha(executable);
  const pricingPath = path.join(root, 'pricing-policy.json');
  await writeFile(pricingPath, JSON.stringify(testPricing, null, 2));
  const pricingPolicySha256 = await fileSha(pricingPath);
  const toolPolicyPath = path.join(root, 'tool-policy.json');
  await writeFile(toolPolicyPath, JSON.stringify(testToolPolicy, null, 2));
  const toolPolicySha256 = await fileSha(toolPolicyPath);
  const authorizationPath = path.join(root, 'codex-authorization.json');
  const value = {
    version: 1,
    runId: 'codex-offline-contract',
    runner: { repository: 'harness-benchmark', commit: 'offline-test' },
    agent: {
      kind: 'codex',
      executable: { path: executable, sha256: executableSha256, version: '0.test-offline' },
      scope: 'decision',
      protocol: { path: protocolPath, sha256: protocolSha256 },
      pricingPolicy: { path: pricingPath, sha256: pricingPolicySha256 },
      toolPolicy: { path: toolPolicyPath, sha256: toolPolicySha256 },
    },
    model: {
      declared: 'gpt-test-offline', provider: 'openai', runtime: process.version,
      resolved: { status: 'unknown', reason: 'offline stub has no provider model snapshot' },
    },
    reasoningEffort: 'max',
    sandbox: 'workspace-write',
    toolCatalogSha256: toolPolicySha256,
    corpus: {
      root: corpusRoot,
      lockSha256: await fileSha(path.join(corpusRoot, 'corpus-lock.json')),
      atomicCatalogSha256: JSON.parse(await readFile(path.join(corpusRoot, 'corpus-lock.json'), 'utf8')).atomicCatalogSha256,
    },
    cells: [{
      ...cell('codex-contract', 5), taskId: 'P0-A03-doc-command', mode: 'atomic', dependencies: [],
      treatment: {
        path: manifestPath, sha256: await fileSha(manifestPath), sourceRoot,
        profile: 'tiny-documentation', platform: platform(),
      },
      order: { repetition: 0, position: 0 },
    }],
    cumulativeJourneys: [],
  };
  await writeFile(authorizationPath, JSON.stringify({
    schemaVersion: 1,
    gate: 'D',
    protocolId: 'offline-test',
    protocolSha: protocolSha256,
    state: 'approved',
    approver: 'Offline Test Approver',
    approverRole: 'Benchmark Maintainer',
    approvedAt: '2026-07-14T00:00:00Z',
    statement: 'Approve the checksum-pinned offline stub decision-run contract.',
    openBlockers: [],
    runId: 'codex-offline-contract',
    scope: 'decision',
    model: 'gpt-test-offline',
    reasoningEffort: 'max',
    executableSha: executableSha256,
    pricingPolicySha: pricingPolicySha256,
    toolPolicySha: toolPolicySha256,
    authMode: 'chatgpt',
    maxInvocations: 2,
    maxPlanCredits: 10,
    maxElapsedSeconds: 60,
    perInvocationCreditReserve: 1,
    authorizesLiveExecution: true,
    authorizesCalibration: false,
    authorizesUS110: true,
    authorizesApiBilling: false,
    authorizesPurchasedCredits: false,
    authorizesOverage: false,
    acceptsPossibleOneAdmittedCallCreditOvershoot: true,
    executionPlanSha: codexExecutionPlanSha(value as unknown as EvaluationPlan),
    runDirectory,
  }, null, 2));
  Object.assign(value.agent, {
    authorization: { path: authorizationPath, sha256: await fileSha(authorizationPath) },
  });
  return writePlan(root, 'codex-plan.json', value);
}

async function cumulativePlan(root: string, agentPath: string, ids: string[]): Promise<string> {
  const corpusRoot = path.join(repositoryRoot, 'benchmark/phase0');
  const lock = JSON.parse(await readFile(path.join(corpusRoot, 'corpus-lock.json'), 'utf8'));
  const manifestPath = path.join(candidateRoot, 'copy-once.json');
  return writePlan(root, 'cumulative-plan.json', {
    version: 1,
    runId: `cumulative-${path.basename(root)}`,
    runner: { repository: 'harness-benchmark', commit: 'offline-test' },
    agent: { kind: 'fake', command: process.execPath, args: [agentPath] },
    model: {
      declared: 'deterministic-fake', provider: 'local', runtime: process.version,
      resolved: { status: 'known', value: 'deterministic-fake' },
    },
    reasoningEffort: 'not-applicable',
    sandbox: 'disposable-temp-directory',
    toolCatalogSha256: sha('fake-agent-only'),
    corpus: {
      root: corpusRoot,
      lockSha256: await fileSha(path.join(corpusRoot, 'corpus-lock.json')),
      atomicCatalogSha256: lock.atomicCatalogSha256,
      cumulativeCatalogSha256: lock.cumulativeCatalogSha256,
    },
    cells: [],
    cumulativeJourneys: await Promise.all(ids.map(async (id, position) => ({
      id,
      journeyId: 'P0-J01-service-evolution',
      treatment: {
        path: manifestPath, sha256: await fileSha(manifestPath), sourceRoot,
        profile: 'cumulative-coordination', platform: platform(),
      },
      timeoutSeconds: 5,
      order: { repetition: 0, position },
    }))),
  });
}

function cumulativeAgent(failFirst: boolean, assertFresh = false): string {
  return [
    "import {access,mkdir,readFile,writeFile} from 'node:fs/promises';",
    "const id=process.env.EVALUATION_CELL_ID; const submission=process.env.EVALUATION_SUBMISSION; await mkdir(submission,{recursive:true});",
    assertFresh
      ? "if(id==='P0-J01-S01-doc'){try{await access('RUNBOOK.md');throw new Error('cross-journey leakage')}catch(error){if(error.code!=='ENOENT')throw error}}"
      : '',
    failFirst ? "if(id==='P0-J01-S01-doc'){process.exitCode=7;}" : '',
    "if(id==='P0-J01-S01-doc'&&!process.exitCode){await writeFile('RUNBOOK.md','npm start on 4200\\n');await writeFile(`${submission}/proof.md`,'README.md config.json\\n');}",
    "if(id==='P0-J01-S02-retry'){const prior=await readFile('RUNBOOK.md','utf8');if(!prior.includes('4200'))throw new Error('missing S01 state');await writeFile('src/queue.js','export function shouldRetry(attempt, limit) { return attempt <= limit; }\\n');await writeFile(`${submission}/proof.md`,'attempt <= limit\\n');}",
    "if(id==='P0-J01-S03-operations'){const prior=await readFile('RUNBOOK.md','utf8');const queue=await readFile('src/queue.js','utf8');if(!prior.includes('npm start')||!queue.includes('attempt <= limit'))throw new Error('missing prior state');await writeFile('RUNBOOK.md',prior+'diagnose retryLimit\\n');await writeFile(`${submission}/proof.md`,'retained outcomes\\n');}",
  ].join('\n');
}

function adapter(executable: string): CodexEvaluationAgent {
  return new CodexEvaluationAgent(
    { path: executable, sha256: shaFileSync(executable), version: '0.test-offline' },
    'gpt-test-offline',
    'max',
    testPricing,
    sha('offline-pricing-policy'),
    testToolPolicy,
    sha('offline-tool-policy'),
  );
}

function cell(id: string, timeoutSeconds: number) {
  return {
    id,
    taskId: 'offline',
    mode: 'atomic' as const,
    dependencies: [],
    treatment: { path: 'unused', sha256: sha('unused'), sourceRoot: 'unused', profile: 'unused', platform: 'test' },
    timeoutSeconds,
    order: { repetition: 0, position: 0 },
  };
}

function expectedCodexEnvironment(): Record<string, string> {
  const names = [
    'PATH', 'HOME', 'USER', 'LOGNAME', 'TMPDIR', 'TMP', 'TEMP', 'LANG', 'LC_ALL',
    'TERM', 'SSL_CERT_FILE', 'SSL_CERT_DIR', 'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY',
  ];
  const entries = names.flatMap((name) => process.env[name] === undefined ? [] : [[name, process.env[name] as string]]);
  return Object.fromEntries(entries);
}

async function executableFile(filePath: string, contents: string): Promise<void> {
  await writeFile(filePath, contents);
  await chmod(filePath, 0o755);
}

async function writePlan(root: string, name: string, value: unknown): Promise<string> {
  const planPath = path.join(root, name);
  await writeFile(planPath, JSON.stringify(value, null, 2));
  return planPath;
}

async function temporary(): Promise<string> {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'decision-runner-prelock-')));
  roots.push(root);
  return root;
}

async function fileSha(filePath: string): Promise<string> {
  return sha(await readFile(filePath));
}

function shaFileSync(filePath: string): string {
  return createHash('sha256').update(require('node:fs').readFileSync(filePath)).digest('hex');
}

function sha(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function platform(): string {
  return process.platform === 'darwin' ? `macos-${process.arch}` : `${process.platform}-${process.arch}`;
}

function quiet() {
  return { stdout: (_value: string) => undefined, stderr: (_value: string) => undefined };
}
