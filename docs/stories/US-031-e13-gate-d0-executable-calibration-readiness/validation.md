# US-031 E13 Gate D0 Executable Calibration Readiness — Validation

## Required Proof

| Layer | Proof |
| --- | --- |
| Unit | Canonical plan/digest, exact schemas, separate ceilings, raw dimension mapping, blinded adapter |
| Integration | Exact plan validation, first-invalid-cell stop receipt, raw records to retained blinded sizing report |
| E2E | Offline readiness verifier rebuilds the complete inert approval packet and rejects mutations |
| Platform | Exact current macOS-arm64 executable/environment identity only; no multi-platform claim |
| Regression | US-030 packet, US-029 runner, qualification suite, architecture, full test suite |
| Live | Intentionally forbidden until a later exact root US-109 approval |

## Negative Canaries

- execution commit differs or US-029 is not its ancestor;
- run ID/path, C01–C18 identity, order, timeout, profile, platform, or policy
  differs;
- authorization digest does not match the semantic plan core;
- second call is attempted after a failure, invalid rubric, or required
  telemetry becomes unknown;
- calibration and future-decision ceilings are conflated;
- report exposes treatment labels, means, ranks, effects, eligibility, or
  candidate selection (the blinded repetition-count selection is permitted);
- packet/transitive identity changes without rebuilding the lock.
- runner or packet bytes change after exact plan assembly but before execution;
- analysis policy has a valid shape but a checksum other than the packet-locked
  policy;
- the inert Gate D0 template's field set differs from the authorization parser.

## Verification Command

```sh
node benchmark/calibration/e13/verify-packet.mjs --source-root ../repository-harness && \
npm run typecheck:orchestrator && \
npm test -- --run \
  benchmark/orchestrator/test/calibration-plan-lock.test.ts \
  benchmark/orchestrator/test/calibration-fail-fast-and-blinded-report.test.ts \
  benchmark/orchestrator/test/held-out-calibration-packet.test.ts \
  benchmark/orchestrator/test/decision-runner-prelock.test.ts
```

Observed offline result on 2026-07-14:

- packet checksum:
  `c51ea105d97c11a642b0eb262a20a69e5107d17e515c2f1cafc2c84f4fd5ee94`;
- packet verifier: `offline-packet-verified`, `liveProviderCalls: 0`;
- focused regression: 4 files, 22 tests passed;
- full regression: 25 files, 147 tests passed;
- build, orchestrator typecheck, and architecture boundary lint passed.
- independent launch audit: no remaining US-031 blockers; required sequence is
  commit, governance binding, exact separate human approval, then execution.
