export interface HarnessCounts {
  intake: number;
  story: number;
  decision: number;
  trace: number;
}

export interface HarnessGateway {
  counts(): Promise<HarnessCounts>;
}
