# US-026 E13 Candidate Materializer

## Status

implemented

## Lane

normal

## Product Contract

Materialize and tear down the three candidate-neutral E13 `US-106` treatment
manifests without invoking the production Repository Harness installer. This is
experimental benchmark assembly code: it receives an already-frozen manifest,
profile, platform, and source identity, then emits a content-addressed receipt.

Governing parent:
`repository-harness/docs/stories/epics/E13-phase-0-product-shape-evaluation/US-106-inventory-payload-and-freeze-candidate-manifests.md`.

## Relevant Product Docs

- `benchmark/PROTOCOL.md`
- `benchmark/receipts/e13/p0-f0-baseline.json`
- Repository Harness E13 decision `0011-phase-0-evaluation-governance.md`
- Repository Harness E13 `US-106` packet and candidate manifests

## Acceptance Criteria

- `materialize` accepts only a non-empty target, supported frozen profile, and
  supported platform.
- Repository, inline, and immutable release-artifact sources are verified
  against declared checksum, byte, line, mode, and commit identities.
- Path traversal and duplicate output paths fail before candidate files are
  written.
- The receipt identifies candidate, profile, task class, platform, manifest,
  selected files, totals, and materialized-tree checksum deterministically.
- `teardown` preflights every owned file and refuses a modified path before
  deleting any candidate-owned path.
- Parent `US-106` proves two identical materializations and two clean teardowns
  for all 120 candidate/profile/platform cells, plus the modified-file canary.
- No live agent, paid comparison, candidate selection, or production installer
  behavior is introduced.

## Design Notes

- Commands: `node benchmark/candidates/e13/materialize-candidate.mjs` with
  `materialize` or `teardown`.
- Source boundary: repository files are extracted from the declared Git object,
  so checkout newline conversion cannot change cross-platform treatment bytes.
- Download boundary: immutable released CLI artifacts use a caller-provided
  cache and must match the manifest before use.
- Ownership boundary: only receipt-listed candidate files are removable.

## Validation

When updating durable proof status, use numeric booleans:
`scripts/bin/harness-cli story update --id US-026 --unit 1 --integration 1 --e2e 0 --platform 1`.

| Layer | Expected proof |
| --- | --- |
| Unit | Materializer syntax and the complete benchmark suite pass. |
| Integration | Parent `US-106` receipt records 120 deterministic pairs, 240 clean teardowns, and the refusal canary. |
| E2E | Not run; no live or paid decision cell is authorized. |
| Platform | The parent contract verifies all five released platform artifacts. |

Verification command:

```bash
test -s benchmark/candidates/e13/materialize-candidate.mjs &&
test "$(shasum -a 256 benchmark/candidates/e13/materialize-candidate.mjs | awk '{print $1}')" = "3554eeb4dac7f0f73e447be2978abcc5fd00e02ffca2b07b1022042f846c2722" &&
node --check benchmark/candidates/e13/materialize-candidate.mjs &&
npm run build &&
npm run typecheck:orchestrator &&
npm run lint:orchestrator &&
npm test -- --run &&
git diff --check
```

## Harness Delta

The benchmark gains one evaluation-only materializer. It does not change the
product API, task runner, existing reports, or the installed Harness workflow.

## Evidence

- Materializer content SHA-256:
  `3554eeb4dac7f0f73e447be2978abcc5fd00e02ffca2b07b1022042f846c2722`.
- Parent receipt records three neutral candidates, eight profiles, five
  platforms, 120 deterministic receipt comparisons, 240 clean teardowns, and
  a passing modified-owned-file refusal canary.
- Benchmark build, orchestrator typecheck, architecture boundaries, and all 117
  tests pass without invoking a live agent.
- Intake `#2`, the durable `US-026` row, and its completion trace bind this
  benchmark implementation to repository-harness parent `US-106`.
