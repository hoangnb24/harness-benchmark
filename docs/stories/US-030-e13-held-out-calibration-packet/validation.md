# US-030 E13 Held-Out Calibration Packet — Validation

## Proof Strategy

All proof is local and deterministic. Executable stubs and synthetic blinded
observations exercise orchestration/statistics; no provider executable or
network path is invoked.

## Test Plan

| Layer | Cases |
| --- | --- |
| Unit | Latin-square df=4, endpoint rules, positive floor, label invariance, multiple-of-six rounding, typed unknown blockers |
| Integration | Frozen fixtures, H02 dirty state, exact schedule, packet/candidate checksums, calibration-only report boundary |
| Negative | Interleaving, imbalance, decision-corpus task, hostile Git config/hooks, candidate tamper, missing ceiling/telemetry, extra report fields |
| Regression | Gate C qualification, US-029 runner, architecture boundary, full test suite |
| External/live | Intentionally not run and not authorized |

Durable proof flags are unit `1`, integration `1`, E2E `1`, and platform `0`.
The platform flag remains false because this story proves the current offline
runtime packet, not a multi-platform execution matrix.

## Story Verification Command

```text
node benchmark/calibration/e13/verify-packet.mjs --source-root ../repository-harness && npm test -- --run benchmark/orchestrator/test/held-out-calibration-packet.test.ts
```

## Full Validation Commands

```text
npm run build
npm run typecheck:orchestrator
npm test -- --run benchmark/orchestrator/test/held-out-calibration-packet.test.ts
npm test -- --run benchmark/orchestrator/test/evaluation-qualification.test.ts
npm test -- --run benchmark/orchestrator/test/decision-runner-prelock.test.ts
npm run lint:orchestrator
npm test -- --run
node benchmark/calibration/e13/verify-packet.mjs --source-root ../repository-harness
git diff --check
```

## Acceptance Boundary

Passing these commands proves only that the offline packet is internally
consistent, deterministic, isolated, and ready for human review. Independent
review and the durable verifier passed, so US-030 is `implemented`. That status
does not approve Gate D0, determine final repetitions, authorize quota use, or
authorize US-110.
