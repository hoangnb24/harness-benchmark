import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { AdherenceScore } from '../domain/adherence';
import type { AdherenceArtifactWriter } from '../application/ScoreAdherence';

export class FsAdherenceArtifactWriter implements AdherenceArtifactWriter {
  constructor(private readonly outputPath: string) {}

  async write(score: AdherenceScore): Promise<void> {
    await mkdir(path.dirname(this.outputPath), { recursive: true });
    await writeFile(this.outputPath, `${JSON.stringify(score, null, 2)}\n`);
  }
}
