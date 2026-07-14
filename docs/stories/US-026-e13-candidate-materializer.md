# US-026 E13 Candidate Materializer

## Status

implemented

## Lane

normal

## Product Contract

Materialize and tear down the three candidate-neutral E13 `US-106` treatment
manifests without invoking the production Repository Harness installer. This is
experimental benchmark assembly code: it receives an already-frozen manifest,
profile, platform, and source identity, stages the checksummed payload, and then
applies the manifest-declared policy to an isolated nonempty fixture. Both
operations emit content-addressed receipts.

Governing parent:
`repository-harness/docs/stories/epics/E13-phase-0-product-shape-evaluation/US-106-inventory-payload-and-freeze-candidate-manifests.md`.

## Relevant Product Docs

- `benchmark/PROTOCOL.md`
- `benchmark/receipts/e13/p0-f0-baseline.json`
- Repository Harness E13 decision `0011-phase-0-evaluation-governance.md`
- Repository Harness E13 `US-106` packet and candidate manifests

## Acceptance Criteria

- `materialize` accepts only an empty staging target, supported frozen profile,
  and supported platform.
- Repository, inline, and immutable release-artifact sources are verified
  against declared checksum, byte, line, mode, and commit identities.
- Path traversal and duplicate output paths fail before candidate files are
  written.
- The receipt identifies candidate, profile, task class, platform, manifest,
  selected files, totals, and materialized-tree checksum deterministically.
- Every manifest declares the same checksummed `applicationPolicy`; `apply`
  interprets that data without branching on `candidateId`.
- `apply` supports deterministic `create-if-absent`, `preserve-existing`,
  `append-marked-block`, and `merge-lines` actions. Existing `AGENTS.md` bytes
  remain the exact result prefix, candidate instructions remain exact under
  frozen markers, and existing `.gitignore` lines are retained.
- Protected README and product-document collisions preserve fixture bytes
  unless a manifest path rule explicitly selects another action.
- Any other existing selected path fails closed; an undeclared collision never
  silently drops candidate payload bytes.
- Application preflight rejects traversal, marker/rule duplication, manifest
  and materialization-receipt mismatch, unexpected staged files, symbolic-link
  paths, `.git` access, and a reused receipt path before mutation.
- After the first target write, result-tree measurement and receipt publication
  remain inside the same transaction. Any later error restores original bytes
  and modes, removes newly created files/directories and partial receipt output,
  then returns the original failure.
- The application receipt records original/staged/result checksums and action
  per selected path, materialization receipt checksum, instruction visibility,
  and original, staged, and resulting tree checksums.
- `teardown` preflights every owned file and refuses a modified path before
  deleting any candidate-owned path.
- Parent `US-106` proves two identical materializations, two identical
  brownfield applications, and two clean teardowns for all 120
  candidate/profile/platform cells, plus fresh and fail-closed canaries.
- No live agent, paid comparison, candidate selection, or production installer
  behavior is introduced.

## Design Notes

- Commands: `node benchmark/candidates/e13/materialize-candidate.mjs` with
  `materialize`, `apply`, or `teardown`.
- Source boundary: repository files are extracted from the declared Git object,
  so checkout newline conversion cannot change cross-platform treatment bytes.
- Download boundary: immutable released CLI artifacts use a caller-provided
  cache and must match the manifest before use.
- Application boundary: staging is verified against both the manifest and its
  materialization receipt before a data-driven plan may touch fixture files.
- Git boundary: `.git` is excluded from tree measurement and no selected path,
  policy rule, or symbolic-link traversal may access it.
- Ownership boundary: only receipt-listed candidate files are removable.

## Validation

When updating durable proof status, use numeric booleans:
`scripts/bin/harness-cli story update --id US-026 --unit 1 --integration 1 --e2e 0 --platform 1`.

| Layer | Expected proof |
| --- | --- |
| Unit | Materializer syntax and the complete benchmark suite pass. |
| Integration | Parent `US-106` receipt records 120 deterministic stage pairs, 120 deterministic application pairs, 240 brownfield applications, 240 clean teardowns, three fresh canaries, and eleven no-partial-write negatives including forced post-mutation output rollback. |
| E2E | Not run; no live or paid decision cell is authorized. |
| Platform | The parent contract verifies all five released platform artifacts. |

Verification command:

```bash
test -s benchmark/candidates/e13/materialize-candidate.mjs &&
test "$(shasum -a 256 benchmark/candidates/e13/materialize-candidate.mjs | awk '{print $1}')" = "0bb99ae578c66cf2faaab52f8635824111585927f89cafc02bf45cc9f4e47bd0" &&
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
  `0bb99ae578c66cf2faaab52f8635824111585927f89cafc02bf45cc9f4e47bd0`.
- Parent receipt records three neutral candidates, one shared application
  policy checksum, eight profiles, five platforms, 120 deterministic staging
  comparisons, 120 deterministic application comparisons, 240 brownfield
  applications, 240 clean teardowns, three fresh applications, and eleven
  no-partial-write negatives.
- Benchmark build, orchestrator typecheck, architecture boundaries, and all 117
  tests pass without invoking a live agent.
- Intake `#2`, the durable `US-026` row, and its completion trace bind this
  benchmark implementation to repository-harness parent `US-106`.
