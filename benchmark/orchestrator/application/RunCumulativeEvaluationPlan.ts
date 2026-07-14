import type { CumulativeJourneyRecord, EvaluationPlan } from '../domain/evaluation';
import type { CumulativeJourneyExecutor } from '../ports/CumulativeJourneyExecutor';

export class RunCumulativeEvaluationPlan {
  constructor(private readonly executor: CumulativeJourneyExecutor) {}

  async execute(plan: EvaluationPlan): Promise<CumulativeJourneyRecord[]> {
    const records: CumulativeJourneyRecord[] = [];
    for (const journey of plan.cumulativeJourneys) {
      records.push(await this.executor.execute(plan, journey));
    }
    return records;
  }
}
