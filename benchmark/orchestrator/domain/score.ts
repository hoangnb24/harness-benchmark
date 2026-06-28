export type ScoreDimension =
  | 'functional'
  | 'harness'
  | 'trace'
  | 'lane'
  | 'adherence'
  | 'evolution'
  | 'cost';

export interface Score {
  dimension: ScoreDimension;
  pass: number;
  total: number;
}

export function scorePct(score: Score): number | null {
  if (score.total === 0) {
    return null;
  }

  return Number(((score.pass * 100) / score.total).toFixed(1));
}
