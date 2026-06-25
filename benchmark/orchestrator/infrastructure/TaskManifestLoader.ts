import { readFile } from 'node:fs/promises';
import { validateRunPlan, type RiskLane, type RunPlan, type TaskDefinition } from '../domain/task';

interface TaskManifestFile {
  version: number;
  tasks: Array<{
    id: string;
    title: string;
    promptPath: string;
    rubricPath: string;
    expectedLane: RiskLane;
    dependencies?: string[];
    functionalCheckPath?: string;
  }>;
}

export class TaskManifestLoader {
  constructor(private readonly manifestPath = 'benchmark/tasks/manifest.json') {}

  async load(runId: string): Promise<RunPlan> {
    const parsed = JSON.parse(await readFile(this.manifestPath, 'utf8')) as TaskManifestFile;

    if (parsed.version !== 1) {
      throw new Error(`unsupported task manifest version: ${parsed.version}`);
    }

    const tasks: TaskDefinition[] = parsed.tasks.map((task) => ({
      id: task.id,
      title: task.title,
      promptPath: task.promptPath,
      rubricPath: task.rubricPath,
      expectedLane: task.expectedLane,
      dependencies: task.dependencies ?? [],
      functionalCheckPath: task.functionalCheckPath,
    }));

    const plan = { runId, tasks };
    validateRunPlan(plan);
    return plan;
  }
}
