import path from 'node:path';
import type { CommandRunner } from './LegacyCodexAdapter';
import type { HarnessInstaller, HarnessInstallOptions } from '../ports/HarnessInstaller';

export class ShellHarnessInstaller implements HarnessInstaller {
  constructor(
    private readonly runner: CommandRunner,
    private readonly prepareScriptPath = path.resolve('benchmark/lib/prepare.sh'),
  ) {}

  async install(options: HarnessInstallOptions): Promise<void> {
    const result = await this.runner.run(
      'bash',
      [
        '-c',
        'source "$1"; install_harness "$2" "$3"',
        'harness-install',
        this.prepareScriptPath,
        options.harnessRef,
        options.projectDir,
      ],
      { cwd: options.projectDir },
    );

    if (result.exitCode !== 0) {
      throw new Error(`harness install failed for ref ${options.harnessRef}`);
    }
  }
}
