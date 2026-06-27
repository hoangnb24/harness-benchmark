export interface HarnessInstallOptions {
  harnessRef: string;
  projectDir: string;
}

export interface HarnessInstaller {
  install(options: HarnessInstallOptions): Promise<void>;
}
