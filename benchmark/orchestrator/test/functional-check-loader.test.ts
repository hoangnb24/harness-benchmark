import { describe, expect, it } from 'vitest';
import { FunctionalCheckLoader } from '../infrastructure/FunctionalCheckLoader';

const taskIds = [
  'T1-project-setup',
  'T2-crud-bookmarks',
  'T3-folder-support',
  'T4-authentication',
  'T5-bug-fix',
  'T6-pagination',
];

describe('FunctionalCheckLoader', () => {
  it('loads all committed T1-T6 declarative check manifests', async () => {
    const loader = new FunctionalCheckLoader();

    for (const taskId of taskIds) {
      const manifest = await loader.load(`benchmark/tasks/checks/${taskId}.json`);
      expect(manifest.version).toBe(1);
      expect(manifest.checks.length).toBeGreaterThan(0);
      expect(manifest.checks.every((check) => Boolean(check.name))).toBe(true);
    }
  });
});
