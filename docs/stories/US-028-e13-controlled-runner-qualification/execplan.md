# US-028 E13 Controlled Runner Qualification — Exec Plan

## Goal

Implement and qualify the benchmark-owned offline runner surface required by
repository parent `US-108`, producing content-addressed Gate C evidence without
live/paid execution or changes to legacy runner/report behavior.

## Scope

In scope:

- Verify frozen US-105/US-106 identities before cell creation.
- Add an evaluation-owned qualification entrypoint and evidence directory.
- Reuse existing TypeScript domain/port boundaries where they satisfy Gate C;
  isolate adaptations behind benchmark-evaluation interfaces.
- Use one planner/assembler/executor/rubric/raw-store/aggregate path for all
  three treatments.
- Run scripted offline positive and fail-closed canaries.
- Record raw cell identities and explicit known/unknown measurements.
- Recompute aggregates from raw cells and record checksum equality.
- Audit locked dependencies for the exact qualification commands/platforms and
  mitigate or prove findings unreachable.
- Preserve legacy files, clean temporary cells, and emit a qualification
  receipt for the repository verifier.

Out of scope:

- Live-agent adapters, paid quota, candidate comparison, or decision output.
- Changes to `benchmark/run.sh`, historical `benchmark/runs/**` reports, or the
  legacy report schema unless a separately reviewed Gate C blocker proves a
  bounded compatibility change is necessary.
- Protocol lock and decision-analysis behavior owned by later E13 stories.
- Production Repository Harness installer/CLI/module behavior.

## Risk Classification

Risk flags:

- Public evidence contract.
- Existing runner/report behavior.
- Cross-platform command/dependency exposure.
- Audit/security of raw identities and dependency findings.
- Weak proof around known timeout, shared-state, rubric, denominator, and
  aggregate failure modes.

Hard gates:

- `--offline` must have no route to a live provider adapter.
- Zero live/paid invocation counters are required in the receipt.
- Frozen input checksum mismatch stops before cell mutation.
- Failed/timed-out/invalid cells cannot pass or vanish from denominators.
- Every metric is known or explicit unknown with reason.
- Qualification and decision-result paths are separate; decision paths stay
  absent.
- Legacy runner/report and historical results remain byte-identical.
- Reachable high/critical advisories block completion.

## Work Phases

1. Pin frozen input, runtime, dependency-lock, sandbox, and tool identities.
2. Spike existing TypeScript boundaries against each Gate C criterion and
   document any bounded replacement requirement.
3. Implement evaluation-owned lock loader, cell planner, isolated assembler,
   scripted adapter, raw store, rubric execution, and aggregation.
4. Add complete cell identity/measurement schemas and atomic writes.
5. Run positive treatment/isolation/identity/aggregate canaries.
6. Run timeout, failure, dependency, workspace contamination, surviving-
   background-descendant, rubric, treatment/receipt mismatch, other identity,
   missing-metric, denominator, raw-cell-set tamper, and aggregate-tamper
   negatives.
7. Complete dependency reachability/mitigation and rebaseline if necessary.
8. Run native benchmark validation, emit receipt, refresh story hashes, and
   hand the content-addressed proof to repository parent `US-108`.

## Stop Conditions

Stop and request review if:

- a command could invoke a live provider or spend quota;
- a frozen input or legacy boundary differs from its recorded identity;
- cell teardown cannot prove isolation;
- a metric/identity would need to be omitted or coerced to zero;
- dependency mitigation changes the runner without rebaselining;
- targeted adaptation cannot meet a named Gate C criterion; or
- implementation would require changing protocol/decision rules owned by
  `US-109`.
