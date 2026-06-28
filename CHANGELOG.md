# Changelog

## 2026-06-25

### Added

- Added the TypeScript benchmark orchestrator path with manifest-loaded T1-T12
  tasks, dry-run planning, real `run --execute`, report generation, and
  adherence collection CLI commands.
- Added multi-agent adapter wiring for Codex, Claude, and custom commands,
  provider-specific usage parsing, a manual pricing guard, per-interaction
  `usage.json`, and compatibility `tokens.json`.
- Added resumable run state, resume selectors, workspace checkpoint
  save/restore, pre-run checkpoints, post-pass task checkpoints, and
  restore-aware execution planning.
- Added deterministic Phase 5 harness-adherence scoring and command-backed
  evidence collection from read-only harness review commands.

### Verification

- `npm run typecheck:orchestrator`
- `npm test`

## 2026-06-13

### Changed

- Added `benchmark/upgrade-plan/` — a proposal (no behavior change) for the next
  benchmark iteration, motivated by recent runs maxing out functional (37/37),
  harness (31/31), and lane (6/6) metrics while exercising none of the Phase 5
  `repository-harness` capabilities.
- The plan covers four workstreams with testable acceptance criteria:
  multi-agent/multi-model usage + cost accounting with a manual pricing table,
  more T1–T6-style challenge tasks plus a log/trace-derived harness-adherence
  review series, a clean-architecture/DI orchestrator restructure, and
  resumable/retryable runs.

### Verification

- Plan-only PR: no scripts changed. Markdown reviewed for internal link and
  file/line references against the current tree.

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
