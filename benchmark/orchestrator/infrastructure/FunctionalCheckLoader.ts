import { readFile } from 'node:fs/promises';
import type { FunctionalCheckManifest } from '../domain/functional-check';

export class FunctionalCheckLoader {
  async load(checkPath: string): Promise<FunctionalCheckManifest> {
    const parsed = JSON.parse(await readFile(checkPath, 'utf8')) as FunctionalCheckManifest;

    if (parsed.version !== 1) {
      throw new Error(`unsupported functional check manifest version: ${parsed.version}`);
    }

    return parsed;
  }
}
