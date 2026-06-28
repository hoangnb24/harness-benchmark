# US-025 TypeScript Runner Harness Install

## Status

implemented

## Lane

normal

## Product Contract

Fresh TypeScript benchmark execution installs Harness from the requested
`repository-harness` ref before running manifest tasks. The installed Harness
must include the Rust CLI built from that checked-out ref, matching the legacy
Bash benchmark flow.

## Relevant Product Docs

- `README.md`
- `benchmark/PROTOCOL.md`
- `benchmark/upgrade-plan/03-clean-architecture-and-di.md`

## Acceptance Criteria

- `harness-bench run --execute --harness <ref>` invokes the Harness prepare
  path before the first task is executed.
- The prepare path receives the requested ref and target workspace directory.
- Fresh runs still execute the manifest-driven task plan, including T1-T12 in
  the default manifest.
- Resumed runs keep using checkpoint state and do not reinstall Harness before
  restoring selected checkpoints.

## Design Notes

- Commands: `harness-bench run --execute`
- Domain rules: `--harness` is an execution input, not just metadata.
- Boundary: TypeScript delegates install mechanics to `benchmark/lib/prepare.sh`
  so checkout, Cargo build, installer merge behavior, and local CLI install stay
  aligned with the old benchmark flow.

## Validation

When updating durable proof status, use numeric booleans:
`scripts/bin/harness-cli story update --id <id> --unit 1 --integration 1 --e2e 0 --platform 0`.

| Layer | Expected proof |
| --- | --- |
| Unit | Installer adapter delegates to the prepare script with the requested ref. |
| Integration | CLI fixture proves install happens before the agent and is included in the pre-run checkpoint. |
| E2E | Not run; no paid benchmark execution was requested. |
| Platform | TypeScript typecheck covers the orchestrator on the local platform. |
| Release | Not applicable. |

## Harness Delta

The TypeScript benchmark runner now installs the target Harness ref for fresh
execution runs, making `--harness` behavior operational instead of metadata-only.

## Evidence

- `npm run typecheck:orchestrator`
- `npm test -- --run benchmark/orchestrator/test`
