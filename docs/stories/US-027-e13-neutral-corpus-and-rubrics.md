# US-027 E13 Neutral Corpus And Rubrics

## Status

implemented

## Lane

normal

## Product Contract

Freeze the repository-harness E13 Phase 0 corpus before any live comparison.
Each atomic task begins from its own deterministic, parentless Git commit and
uses an executable, candidate-neutral rubric with a fixed four-check
denominator. Keep the cumulative coordination journey separate so a later
step's solved workspace cannot inflate an atomic score.

Governing parent:
`repository-harness/docs/stories/epics/E13-phase-0-product-shape-evaluation/US-105-freeze-corpus-and-neutral-rubrics.md`.

This story invokes no live or paid agent and produces no candidate ranking.

## Relevant Product Docs

- `benchmark/phase0/README.md`
- `benchmark/PROTOCOL.md`
- `benchmark/receipts/e13/p0-f0-baseline.json`
- Repository Harness E13 decision `0011-phase-0-evaluation-governance.md`
- Repository Harness E13 parent `US-105`

## Acceptance Criteria

- The atomic catalog contains 16 tasks spanning all seven atomic US-106
  activation profiles, with at least two tasks per profile and four split
  identity/data tasks for the combined high-risk profile.
- Every task has a unique fixture, prompt, rubric, and deterministic parentless
  start commit identity; every seed resets twice to the same commit and tree.
- One separate three-step cumulative journey is explicitly excluded from
  atomic counts and class aggregates.
- Each atomic rubric has exactly four checks and fails closed when a check is
  missing, unevaluable, or violates a critical boundary.
- Defect, behavior-change, and high-risk rubrics run frozen behavior probes and
  record command, timeout, exit, stdout, and stderr evidence.
- All 16 positive canaries pass 4/4, while missing-rubric, comment-only
  false-positive, safety, denominator, and contamination canaries fail.
- Verification removes temporary workspaces and reports zero live-agent
  invocations.

## Cause And Effect

For example, `P0-A09-identity-tenant` starts from a commit containing a tenant
authorization defect. The positive submission must pass same-tenant,
cross-tenant, and missing-user probes. The false-positive canary puts
`user.tenantId === record.tenantId` only in a comment while executable code
still permits every present user. Because the rubric executes the cross-tenant
probe, that canary fails; persuasive text cannot become correctness evidence.

Likewise, the denominator canary supplies only three of four required
outcomes. Its result remains 3/4 and fails instead of silently shrinking to
3/3. Therefore missing evidence cannot improve a score.

## Validation

Verification command:

```bash
node benchmark/phase0/verify-corpus.mjs &&
npm run build &&
npm run typecheck:orchestrator &&
npm run lint:orchestrator &&
npm test -- --run &&
git diff --check
```

When updating durable proof status, use numeric booleans:
`scripts/bin/harness-cli story update --id US-027 --unit 1 --integration 1 --e2e 0 --platform 0`.

| Layer | Expected proof |
| --- | --- |
| Unit | Catalog, lock, materializer, rubric structure, positive canaries, and five fail-closed canaries pass. |
| Integration | Every atomic seed and the cumulative root reset twice with identical commit/tree identities; executable behavior receipts are complete. |
| E2E | Not run because Gate D has not authorized live or paid comparison cells. |
| Platform | Not claimed; corpus materialization is qualified on the current development host, while treatment platforms belong to `US-106`/`US-108`. |

## Harness Delta

The benchmark gains a frozen Phase 0 corpus, deterministic fixture
materializer, executable rubric runner, lock, canary declarations, and
verification receipt. It does not change the legacy task runner, production
Repository Harness installer, or candidate treatments.

## Evidence

- `corpus-lock.json` SHA-256:
  `cc72d8618a86dd1f561692f6fac6d677d1f1150287ba4416d06a34208b7c55e0`.
- `verification-receipt.json` SHA-256:
  `51e9025285fc41584c4be5d2b4da2b124b847d2e59ae55c1e125a58432ba975c`.
- Receipt result: 16/16 positive canaries at 4/4, five negative canaries
  rejected, eight executable behavior-probe receipts, two resets per atomic
  seed, two cumulative-root resets, and zero live-agent invocations.
- Parent `US-105` owns the cross-repository contract and final benchmark commit
  pin.
