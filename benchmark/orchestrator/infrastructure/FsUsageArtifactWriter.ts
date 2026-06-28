import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { TaskUsageArtifact, TokensCompatibilityArtifact } from '../domain/usage';
import type { UsageArtifactWriter } from '../ports/UsageArtifactWriter';

export class FsUsageArtifactWriter implements UsageArtifactWriter {
  async writeUsage(taskDir: string, artifact: TaskUsageArtifact): Promise<void> {
    await writeJson(path.join(taskDir, 'usage.json'), artifact);
  }

  async writeTokens(taskDir: string, artifact: TokensCompatibilityArtifact): Promise<void> {
    await writeJson(path.join(taskDir, 'tokens.json'), artifact);
  }
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}
