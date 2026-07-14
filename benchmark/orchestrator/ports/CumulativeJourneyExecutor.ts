import type {
  CumulativeJourneyRecord,
  CumulativeJourneySpec,
  EvaluationPlan,
} from '../domain/evaluation';

export interface CumulativeJourneyExecutor {
  execute(plan: EvaluationPlan, journey: CumulativeJourneySpec): Promise<CumulativeJourneyRecord>;
}
