import { describe, expect, it } from 'vitest';
import { FunctionalCheckLoader } from '../infrastructure/FunctionalCheckLoader';

const taskIds = [
  'T1-project-setup',
  'T2-crud-bookmarks',
  'T3-folder-support',
  'T4-authentication',
  'T5-bug-fix',
  'T6-pagination',
  'T7-tags',
  'T8-search',
  'T9-import-export',
  'T10-folder-sharing',
  'T11-concurrency',
  'T12-cursor-pagination',
];

describe('FunctionalCheckLoader', () => {
  it('loads all committed declarative check manifests', async () => {
    const loader = new FunctionalCheckLoader();

    for (const taskId of taskIds) {
      const manifest = await loader.load(`benchmark/tasks/checks/${taskId}.json`);
      expect(manifest.version).toBe(1);
      expect(manifest.checks.length).toBeGreaterThan(0);
      expect(manifest.checks.every((check) => Boolean(check.name))).toBe(true);
    }
  });
});
