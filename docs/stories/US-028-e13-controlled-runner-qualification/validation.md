# US-028 E13 Controlled Runner Qualification — Validation

## Proof Strategy

Exercise the measurement system with deterministic scripted outcomes, not a
live agent. Every treatment gets the same fixture/application/execution/rubric/
raw-store path. Positive canaries prove correct assembly, identity, isolation,
status, cleanup, and raw aggregation. Negative canaries inject the exact Gate C
failure modes and must be rejected without contaminating later cells.

## Frozen Inputs

- US-105 benchmark commit:
  `8e3814cd43d235c95531fbe95b18455acc10838a`
- `benchmark/phase0/corpus-lock.json`:
  `cc72d8618a86dd1f561692f6fac6d677d1f1150287ba4416d06a34208b7c55e0`
- `benchmark/phase0/verification-receipt.json`:
  `51e9025285fc41584c4be5d2b4da2b124b847d2e59ae55c1e125a58432ba975c`
- US-106 materializer commit:
  `3729da1293545d70a96ac1c8555e68018e388252`
- Candidate materializer:
  `0bb99ae578c66cf2faaab52f8635824111585927f89cafc02bf45cc9f4e47bd0`
- Repository US-106 parent receipt:
  `4ac987e26f4d5a72fb45a135bd5d386f520992052225450c74582a953f7bb1bb`
- Candidate manifests: `FULL_V0` `58b475c1...`, `COPY_ONCE` `5b77e5b4...`,
  `MODULAR_CORE` `43b042b5...`; shared policy `e79764e...`.

## Positive Canaries

- `three-treatment-paths`
- `successful-process-rubric`
- `expected-product-failure`
- `isolated-reset`
- `complete-identities`
- `raw-aggregate-recompute`
- `cleanup-and-legacy-boundary`

Each must emit a raw artifact and an explicit passed qualification disposition.
No positive canary is a candidate score.

## Negative Canaries

- `timeout-cannot-pass`
- `failed-process-cannot-pass`
- `atomic-dependency-rejected`
- `contamination-rejected`
- `process-contamination-rejected`
- `missing-rubric-rejected`
- `unused-rubric-rejected`
- `identity-missing-rejected`
- `identity-mismatch-rejected`
- `treatment-mismatch-rejected`
- `missing-metric-is-unknown`
- `missing-metric-zero-rejected`
- `denominator-shrink-rejected`
- `raw-cell-tamper-rejected`
- `aggregate-tamper-rejected`

The receipt records these as rejected injected faults. Timeout/failure cannot be
rescued by partial probes, atomic dependencies cannot run, contamination cannot
reach another cell (including through a surviving background descendant),
rubric/identity faults and treatment/receipt mismatches cannot aggregate,
unknown telemetry cannot become zero, denominators cannot shrink, the raw-cell
set cannot be missing/duplicated/extended/modified, and aggregate tampering
cannot match independent reconstruction.

## Test Plan

| Layer | Cases |
| --- | --- |
| Unit | Lock/schema validation, status precedence, explicit unknowns, denominator, identity completeness, raw aggregation. |
| Integration | Frozen fixture plus candidate application, scripted adapter, rubric runner, raw store, cleanup, dependency evidence. |
| E2E | `verify-qualification.mjs --offline` emits the complete receipt and zero-agent proof. |
| Platform | Qualified Node hosts and explicit audit reachability for every claimed platform. |
| Performance | Offline qualification duration/storage recorded diagnostically only. |
| Logs/Audit | Raw checksums, process/workspace/test/rubric/metrics, legacy preservation, cleanup, aggregate reproduction. |

## Commands

Before implementation, the parent documentation/input contract must pass:

```bash
cd /Users/themrb/Documents/personal/repository-harness
HARNESS_BENCHMARK_ROOT=/Users/themrb/Documents/personal/harness-benchmark \
  scripts/verify-e13-us108.sh --contract-only
```

After implementation:

```bash
node benchmark/evaluation/verify-qualification.mjs --offline \
  --repository-harness-root /Users/themrb/Documents/personal/repository-harness
npm run build
npm run typecheck:orchestrator
npm run lint:orchestrator
npm test -- --run
npm audit --json

cd /Users/themrb/Documents/personal/repository-harness
HARNESS_BENCHMARK_ROOT=/Users/themrb/Documents/personal/harness-benchmark \
  scripts/verify-e13-us108.sh
```

## Dependency Audit Acceptance

- Exact lock and raw `npm audit --json` output are checksummed.
- Disposition is either `mitigated-and-rebaselined` or
  `proven-unreachable-in-qualified-path`.
- Claimed platforms are explicit; Windows findings receive a Windows-specific
  disposition before a Windows claim.
- Reachable or unexplained high/critical exposure fails qualification.

## Immutable Evidence

| Field | Final value |
| --- | --- |
| Qualified runner commit | `d9e05e395c5c9db8ca5a646e602947156f426b85` |
| Qualification entrypoint SHA-256 | `f486266de5ba7f4a093df8be7ae1cd6684a198d9ab1637329b0b77dc3343ad1f` |
| Raw-cell manifest SHA-256 | `d0236faa96cb9d79855fd80d2ab16931fae97af19a51734d4aaf1c94293210d8` |
| Qualification aggregate SHA-256 | `c1764e6fea52b6082f5c6dd9cd60301d4d935500ce143036d484a73fb7e26bc0` |
| Dependency audit SHA-256/disposition | `ce9c454f556f1dee7f7548ff775cbf64726e263762888751e2f0be8a77cd1ca2`; `mitigated-and-rebaselined` |
| Qualification receipt SHA-256 | `73099b735b09faee966a9d20e5b813da55df13cd01c394f87ce56340031c546b` |
| Positive/negative canary counts | `7` passed / `15` injected faults rejected |

## Acceptance Evidence

Complete. Three isolated real cells exercised `FULL_V0`, `COPY_ONCE`, and
`MODULAR_CORE` through the same materialize/apply/fake-agent/rubric/raw-store
path and reproduced a `12/12` qualification aggregate. All seven positive
canaries passed, all fifteen injected faults were rejected, the exact lock
audited at zero vulnerabilities, legacy runner/report bytes remained unchanged,
and the receipt proves zero live and zero paid agent invocations. This is Gate C
qualification evidence only; it is not a comparison or candidate selection.
