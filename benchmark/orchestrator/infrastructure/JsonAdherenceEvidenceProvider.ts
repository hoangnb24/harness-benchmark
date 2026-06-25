import { readFile } from 'node:fs/promises';
import type { AdherenceEvidence } from '../domain/adherence';
import type { AdherenceEvidenceProvider } from '../application/ScoreAdherence';

export class JsonAdherenceEvidenceProvider implements AdherenceEvidenceProvider {
  constructor(private readonly evidencePath: string) {}

  async load(): Promise<AdherenceEvidence> {
    return JSON.parse(await readFile(this.evidencePath, 'utf8')) as AdherenceEvidence;
  }
}
