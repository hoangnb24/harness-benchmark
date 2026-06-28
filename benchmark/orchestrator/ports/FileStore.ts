export interface FileStore {
  ensureDir(path: string): Promise<void>;
}
