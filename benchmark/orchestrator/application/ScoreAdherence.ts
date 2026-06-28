import type { AdherenceEvidence, AdherenceScore } from '../domain/adherence';
import { ReviewAdherence } from './ReviewAdherence';

export interface AdherenceEvidenceProvider {
  load(): Promise<AdherenceEvidence>;
}

export interface AdherenceArtifactWriter {
  write(score: AdherenceScore): Promise<void>;
}

export class ScoreAdherence {
  constructor(
    private readonly evidence: AdherenceEvidenceProvider,
    private readonly writer: AdherenceArtifactWriter,
    private readonly reviewer = new ReviewAdherence(),
  ) {}

  async run(): Promise<AdherenceScore> {
    const score = this.reviewer.review(await this.evidence.load());
    await this.writer.write(score);
    return score;
  }
}
