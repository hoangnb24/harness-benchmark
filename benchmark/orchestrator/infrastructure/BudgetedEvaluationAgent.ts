import type { EvaluationCellSpec } from '../domain/evaluation';
import type { EvaluationCellExecution, EvaluationCellExecutor } from '../ports/EvaluationCellExecutor';
import type { VerifiedCodexExecutionAuthorization } from './CodexExecutionAuthorization';

export class BudgetedEvaluationAgent implements EvaluationCellExecutor {
  private invocations = 0;
  private consumedPlanCredits = 0;
  private stoppedReason: string | undefined;

  constructor(
    private readonly delegate: EvaluationCellExecutor,
    private readonly limits: VerifiedCodexExecutionAuthorization['limits'],
    private readonly startedAt = Date.now(),
  ) {}

  async execute(input: {
    cell: EvaluationCellSpec;
    workspaceDir: string;
    submissionDir: string;
    prompt: string;
  }): Promise<EvaluationCellExecution> {
    if (this.stoppedReason) throw new Error(`Codex execution budget stopped: ${this.stoppedReason}`);
    if (this.invocations + 1 > this.limits.maxInvocations) {
      throw new Error('Codex execution budget stopped: invocation ceiling reached');
    }
    const elapsedSeconds = (Date.now() - this.startedAt) / 1000;
    const remainingSeconds = this.limits.maxElapsedSeconds - elapsedSeconds;
    if (remainingSeconds <= 0) {
      throw new Error('Codex execution budget stopped: elapsed-time ceiling reached');
    }
    if (this.consumedPlanCredits + this.limits.perInvocationCreditReserve > this.limits.maxPlanCredits) {
      throw new Error('Codex execution budget stopped: per-invocation credit reserve exceeds remaining credits');
    }
    const result = await this.delegate.execute({
      ...input,
      cell: {
        ...input.cell,
        timeoutSeconds: Math.min(input.cell.timeoutSeconds, remainingSeconds),
      },
    });
    this.invocations += 1;
    if (!result.consumedPlanCredits || result.consumedPlanCredits.status === 'unknown') {
      this.stoppedReason = 'required plan-credit telemetry is unknown';
    } else {
      this.consumedPlanCredits += result.consumedPlanCredits.value;
      if (this.consumedPlanCredits > this.limits.maxPlanCredits) {
        this.stoppedReason = 'observed plan-credit ceiling was crossed';
      }
    }
    if ((Date.now() - this.startedAt) / 1000 >= this.limits.maxElapsedSeconds) {
      this.stoppedReason = 'elapsed-time ceiling was crossed';
    }
    if (this.stoppedReason) {
      return {
        ...result,
        exitCode: result.exitCode === 0 ? 125 : result.exitCode,
        stderr: Buffer.concat([
          result.stderr,
          Buffer.from(`\nCodex execution budget stopped: ${this.stoppedReason}\n`),
        ]),
      };
    }
    return result;
  }
}
