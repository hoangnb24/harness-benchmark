import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, readFile, realpath } from 'node:fs/promises';
import type { EvaluationCellSpec, KnownOrUnknown } from '../domain/evaluation';
import type { EvaluationCellExecution, EvaluationCellExecutor } from '../ports/EvaluationCellExecutor';
import { sha256File } from './EvaluationFiles';
import type { CodexPricingPolicy, CodexToolPolicy } from './CodexExecutionAuthorization';

export interface CodexExecutableIdentity {
  path: string;
  sha256: string;
  version: string;
}

export class CodexEvaluationAgent implements EvaluationCellExecutor {
  private preflightPromise: Promise<{
    version: Awaited<ReturnType<CodexEvaluationAgent['assertExecutableVersion']>>;
    authentication: Awaited<ReturnType<CodexEvaluationAgent['assertChatGptAuthentication']>>;
  }> | undefined;

  constructor(
    private readonly executable: CodexExecutableIdentity,
    private readonly model: string,
    private readonly reasoningEffort: string,
    private readonly pricing: CodexPricingPolicy,
    private readonly pricingPolicySha256: string,
    private readonly toolPolicy: CodexToolPolicy,
    private readonly toolPolicySha256: string,
    private readonly maxElapsedSeconds?: number,
    private readonly budgetStartedAt = Date.now(),
  ) {}

  preflight(): Promise<{
    version: Awaited<ReturnType<CodexEvaluationAgent['assertExecutableVersion']>>;
    authentication: Awaited<ReturnType<CodexEvaluationAgent['assertChatGptAuthentication']>>;
  }> {
    this.preflightPromise ??= (async () => {
      await this.assertExecutableIdentity();
      const version = await this.assertExecutableVersion();
      const authentication = await this.assertChatGptAuthentication();
      await this.assertExecutableIdentity();
      return { version, authentication };
    })();
    return this.preflightPromise;
  }

  async execute(input: {
    cell: EvaluationCellSpec;
    workspaceDir: string;
    submissionDir: string;
    prompt: string;
  }): Promise<EvaluationCellExecution> {
    const preflight = await this.preflight();
    // Recheck the executable immediately before every model subprocess.
    await this.assertExecutableIdentity();
    const args = [
      'exec',
      '--json',
      '--ephemeral',
      '--ignore-user-config',
      '--strict-config',
      '--model',
      this.model,
      '-c',
      `model_reasoning_effort=${JSON.stringify(this.reasoningEffort)}`,
      '-c',
      'approval_policy="never"',
      ...Object.keys(this.toolPolicy.featureOverrides).sort().flatMap((feature) => [
        '-c', `features.${feature}=false`,
      ]),
      '-c', `sandbox_workspace_write.network_access=${String(this.toolPolicy.networkAccess)}`,
      '-c', `web_search=${JSON.stringify(this.toolPolicy.webSearch)}`,
      '--sandbox',
      'workspace-write',
      '-C',
      input.workspaceDir,
      '--add-dir',
      input.submissionDir,
    ];
    const started = Date.now();
    const processResult = await runProcessGroup(this.executable.path, args, {
      cwd: input.workspaceDir,
      stdin: input.prompt,
      timeoutSeconds: this.remainingSeconds(input.cell.timeoutSeconds),
      env: codexEnvironment(),
    });
    const usage = parseUsage(processResult.stdout, this.pricing.rates);
    const policyError = usage.policyViolation
      ? Buffer.from(`\nCodex tool-policy violation: ${usage.policyViolation}\n`)
      : Buffer.alloc(0);
    return {
      ...processResult,
      exitCode: usage.policyViolation && processResult.exitCode === 0 ? 126 : processResult.exitCode,
      stderr: Buffer.concat([processResult.stderr, policyError]),
      wallMilliseconds: Date.now() - started,
      inputTokens: usage.inputTokens,
      cachedInputTokens: usage.cachedInputTokens,
      outputTokens: usage.outputTokens,
      toolLoops: usage.toolLoops,
      consumedPlanCredits: usage.consumedPlanCredits,
      costUsd: unknown('per-cell USD cost is unavailable for the Codex ChatGPT-plan adapter'),
      metricsReceipt: Buffer.from(`${JSON.stringify({
        schemaVersion: 1,
        source: 'codex-jsonl',
        executable: this.executable,
        pricingPolicySha256: this.pricingPolicySha256,
        toolPolicySha256: this.toolPolicySha256,
        preflight: {
          version: preflight.version,
          authentication: preflight.authentication,
        },
        policyViolation: usage.policyViolation,
        emitted: usage.emitted,
        values: {
          inputTokens: knownValue(usage.inputTokens),
          cachedInputTokens: knownValue(usage.cachedInputTokens),
          outputTokens: knownValue(usage.outputTokens),
          toolLoops: knownValue(usage.toolLoops),
          consumedPlanCredits: knownValue(usage.consumedPlanCredits),
          costUsd: null,
        },
        measurements: {
          inputTokens: usage.inputTokens,
          cachedInputTokens: usage.cachedInputTokens,
          outputTokens: usage.outputTokens,
          toolLoops: usage.toolLoops,
          consumedPlanCredits: usage.consumedPlanCredits,
          costUsd: unknown('per-cell USD cost is unavailable for the Codex ChatGPT-plan adapter'),
        },
      })}\n`),
    };
  }

  private async assertExecutableIdentity(): Promise<void> {
    const details = await lstat(this.executable.path);
    if (!details.isFile() || details.isSymbolicLink()) {
      throw new Error('Codex executable must be a regular non-symbolic-link file');
    }
    if ((await sha256File(this.executable.path)) !== this.executable.sha256) {
      throw new Error('Codex executable checksum mismatch');
    }
    if ((await realpath(this.executable.path)) !== this.executable.path) {
      throw new Error('Codex executable path must already be its canonical real path');
    }
    if (!this.executable.version.trim()) throw new Error('Codex executable version is required');
  }

  private async assertExecutableVersion(): Promise<{
    observed: string;
    stdout: string;
    stderr: string;
    stdoutSha256: string;
    stderrSha256: string;
  }> {
    const result = await runProcessGroup(this.executable.path, ['--version'], {
      cwd: process.cwd(),
      stdin: '',
      timeoutSeconds: this.remainingSeconds(10),
      env: codexEnvironment(),
    });
    if (result.exitCode !== 0 || result.timedOut || result.signal) {
      throw new Error(`Codex executable version preflight failed with exit ${result.exitCode}`);
    }
    const stdout = result.stdout.toString('utf8');
    const stderr = result.stderr.toString('utf8');
    const expected = `codex-cli ${this.executable.version}`;
    if (stdout.trim() !== expected || stderr !== '') {
      throw new Error(`Codex executable version mismatch: expected ${expected}, got ${stdout.trim() || 'empty'}`);
    }
    return {
      observed: this.executable.version,
      stdout,
      stderr,
      stdoutSha256: sha256Buffer(result.stdout),
      stderrSha256: sha256Buffer(result.stderr),
    };
  }

  private async assertChatGptAuthentication(): Promise<{
    mode: 'chatgpt';
    stdout: string;
    stderr: string;
    stdoutSha256: string;
    stderrSha256: string;
  }> {
    const result = await runProcessGroup(this.executable.path, ['login', 'status'], {
      cwd: process.cwd(),
      stdin: '',
      timeoutSeconds: this.remainingSeconds(10),
      env: codexEnvironment(),
    });
    const stdout = result.stdout.toString('utf8');
    const stderr = result.stderr.toString('utf8');
    if (result.exitCode !== 0 || result.timedOut || result.signal || stdout.trim() !== 'Logged in using ChatGPT' || stderr !== '') {
      throw new Error('Codex executable is not authenticated with the approved ChatGPT plan mode');
    }
    return {
      mode: 'chatgpt',
      stdout,
      stderr,
      stdoutSha256: sha256Buffer(result.stdout),
      stderrSha256: sha256Buffer(result.stderr),
    };
  }

  private remainingSeconds(perProcessMaximum: number): number {
    if (this.maxElapsedSeconds === undefined) return perProcessMaximum;
    const remaining = this.maxElapsedSeconds - (Date.now() - this.budgetStartedAt) / 1000;
    if (remaining <= 0) throw new Error('Codex execution budget stopped: elapsed-time ceiling reached');
    return Math.min(perProcessMaximum, remaining);
  }
}

function sha256Buffer(value: Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function codexEnvironment(): NodeJS.ProcessEnv {
  const names = [
    'PATH', 'HOME', 'USER', 'LOGNAME', 'TMPDIR', 'TMP', 'TEMP', 'LANG', 'LC_ALL',
    'TERM', 'SSL_CERT_FILE', 'SSL_CERT_DIR', 'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY',
  ];
  const entries = names.flatMap((name) => {
    const value = process.env[name];
    return value === undefined ? [] : [[name, value]];
  });
  return Object.fromEntries(entries);
}

async function runProcessGroup(
  command: string,
  args: string[],
  options: { cwd: string; stdin: string; timeoutSeconds: number; env: NodeJS.ProcessEnv },
): Promise<{ exitCode: number; signal: NodeJS.Signals | null; timedOut: boolean; stdout: Buffer; stderr: Buffer }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      detached: process.platform !== 'win32',
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let timedOut = false;
    let settled = false;
    const timer = setTimeout(() => {
      timedOut = true;
      terminateTree(child.pid, 'SIGKILL');
    }, options.timeoutSeconds * 1000);
    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      terminateTree(child.pid, 'SIGKILL');
      resolve({
        exitCode: timedOut ? 124 : code ?? signalExitCode(signal),
        signal,
        timedOut,
        stdout: Buffer.concat(stdout),
        stderr: Buffer.concat(stderr),
      });
    });
    child.stdin.end(options.stdin);
  });
}

function terminateTree(pid: number | undefined, signal: NodeJS.Signals): void {
  if (!pid) return;
  try {
    if (process.platform === 'win32') {
      const killer = spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore', shell: false });
      killer.unref();
    } else {
      process.kill(-pid, signal);
    }
  } catch {
    // The process group may already have exited.
  }
}

function signalExitCode(signal: NodeJS.Signals | null): number {
  if (signal === 'SIGKILL') return 137;
  if (signal === 'SIGTERM') return 143;
  return 1;
}

function parseUsage(
  jsonl: Buffer,
  rates: CodexPricingPolicy['rates'],
): {
  emitted: boolean;
  inputTokens: KnownOrUnknown<number>;
  cachedInputTokens: KnownOrUnknown<number>;
  outputTokens: KnownOrUnknown<number>;
  toolLoops: KnownOrUnknown<number>;
  consumedPlanCredits: KnownOrUnknown<number>;
  policyViolation: string | null;
} {
  let latest: Record<string, unknown> | undefined;
  let toolLoops = 0;
  let completedTurn = false;
  let malformedJsonl = false;
  const completedToolIds = new Set<string>();
  const forbiddenCompletedItems = new Set<string>();
  for (const line of jsonl.toString('utf8').split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line) as Record<string, unknown>;
      if (event.type === 'turn.completed') {
        completedTurn = true;
        const usage = event.usage;
        latest = usage && typeof usage === 'object' && !Array.isArray(usage)
          ? usage as Record<string, unknown>
          : undefined;
      }
      if (isToolLoop(event)) {
        const item = event.item as Record<string, unknown>;
        const id = typeof item.id === 'string' && item.id !== '' ? item.id : undefined;
        if (!id || !completedToolIds.has(id)) {
          toolLoops += 1;
          if (id) completedToolIds.add(id);
        }
      }
      if (event.type === 'item.completed') {
        const item = event.item;
        const itemType = item && typeof item === 'object' && !Array.isArray(item)
          ? (item as Record<string, unknown>).type
          : undefined;
        if (
          typeof itemType === 'string' &&
          !['agent_message', 'reasoning', 'error', 'command_execution', 'file_change'].includes(itemType)
        ) {
          forbiddenCompletedItems.add(itemType);
        }
      }
    } catch {
      malformedJsonl = true;
      // Preserve malformed provider output verbatim; missing parseable usage stays unknown.
    }
  }
  const input = numberAt(latest, ['input_tokens', 'inputTokens']);
  const cachedInput = numberAt(latest, ['cached_input_tokens', 'cachedInputTokens']);
  const output = numberAt(latest, ['output_tokens', 'outputTokens']);
  const credits = input === undefined || cachedInput === undefined || output === undefined || cachedInput > input
    ? undefined
    : (
      (Math.max(0, input - cachedInput) * rates.input) +
      (cachedInput * rates.cachedInput) +
      (output * rates.output)
    ) / 1_000_000;
  return {
    emitted: Boolean(latest),
    inputTokens: input === undefined ? unknown('inputTokens was not emitted in Codex JSONL') : { status: 'known', value: input },
    cachedInputTokens: cachedInput === undefined
      ? unknown('cachedInputTokens was not emitted in Codex JSONL')
      : { status: 'known', value: cachedInput },
    outputTokens: output === undefined ? unknown('outputTokens was not emitted in Codex JSONL') : { status: 'known', value: output },
    toolLoops: completedTurn && !malformedJsonl
      ? { status: 'known', value: toolLoops }
      : unknown('toolLoops is unknown because Codex JSONL is malformed or has no completed turn'),
    consumedPlanCredits: credits === undefined
      ? unknown('consumedPlanCredits requires input, cached-input, and output token telemetry')
      : { status: 'known', value: credits },
    policyViolation: forbiddenCompletedItems.size === 0
      ? null
      : `unexpected completed item types: ${[...forbiddenCompletedItems].sort().join(', ')}`,
  };
}

function isToolLoop(event: Record<string, unknown>): boolean {
  if (event.type !== 'item.completed') return false;
  const item = event.item;
  if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
  const type = (item as Record<string, unknown>).type;
  return typeof type === 'string' && [
    'command_execution', 'file_change',
  ].includes(type);
}

function numberAt(record: Record<string, unknown> | undefined, names: string[]): number | undefined {
  for (const name of names) {
    const value = record?.[name];
    if (typeof value === 'number' && Number.isInteger(value) && value >= 0) return value;
  }
  return undefined;
}

function unknown(reason: string): KnownOrUnknown<number> {
  return { status: 'unknown', reason };
}

function knownValue(value: KnownOrUnknown<number>): number | null {
  return value.status === 'known' ? value.value : null;
}
