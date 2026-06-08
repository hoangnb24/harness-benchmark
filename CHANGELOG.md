# Changelog

## 2026-06-08

### Changed

- Benchmark harness installation uses the requested `repository-harness` ref as
  the source of truth for the Rust CLI.
- `benchmark/lib/prepare.sh` fetches the target harness branch, builds
  `harness-cli` with Cargo, installs the built binary at
  `scripts/bin/harness-cli`, and initializes `harness.db` through that binary.
- Benchmark runs no longer rely on the latest prebuilt Harness CLI release when
  testing a specific harness branch.

### Verification

- `bash -n benchmark/lib/prepare.sh benchmark/run.sh`
- Temp install smoke: built the local CLI, skipped the installer download path,
  created `harness.db`, and ran `scripts/bin/harness-cli --version`.
