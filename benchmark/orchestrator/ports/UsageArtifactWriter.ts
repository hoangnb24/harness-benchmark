import type { TaskUsageArtifact, TokensCompatibilityArtifact } from '../domain/usage';

export interface UsageArtifactWriter {
  writeUsage(taskDir: string, artifact: TaskUsageArtifact): Promise<void>;
  writeTokens(taskDir: string, artifact: TokensCompatibilityArtifact): Promise<void>;
}
