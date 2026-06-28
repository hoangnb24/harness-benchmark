import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const guardedDirs = [
  path.join('benchmark', 'orchestrator', 'domain'),
  path.join('benchmark', 'orchestrator', 'application'),
];

describe('orchestrator architecture boundaries', () => {
  it('keeps domain and application independent from infrastructure and interface layers', async () => {
    const violations: string[] = [];

    for (const dir of guardedDirs) {
      for (const filePath of await tsFiles(dir)) {
        const contents = await readFile(filePath, 'utf8');
        for (const specifier of importSpecifiers(contents)) {
          if (specifier.includes('/infrastructure/') || specifier.includes('/interface/')) {
            violations.push(`${filePath} imports ${specifier}`);
          }
        }
      }
    }

    expect(violations).toEqual([]);
  });
});

async function tsFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        return tsFiles(entryPath);
      }

      return entry.name.endsWith('.ts') ? [entryPath] : [];
    }),
  );

  return files.flat();
}

function importSpecifiers(contents: string): string[] {
  const matches = contents.matchAll(/\bimport(?:\s+type)?[\s\S]*?\sfrom\s+['"]([^'"]+)['"]/g);
  return [...matches].map((match) => normalizeSpecifier(match[1]));
}

function normalizeSpecifier(specifier: string): string {
  return specifier.replace(/\\/g, '/');
}
