# US-028 E13 Controlled Runner Qualification — Design

## Domain Model

- `QualificationInputLock`: runner/runtime/dependency plus frozen US-105/US-106
  identities.
- `QualificationCanary`: deterministic positive or injected-fault scenario.
- `QualificationCellPlan`: candidate, atomic seed, prompt/rubric, scripted
  outcome, order, timeout, and correction-policy identities.
- `RawQualificationCell`: complete identity groups, raw process/workspace/test/
  rubric/usage evidence, and primary disposition.
- `Measurement`: known value/unit or unknown reason.
- `QualificationAggregate`: deterministic raw-cell projection with no ranking.
- `QualificationReceipt`: hashes inputs, raw manifest, aggregate, dependency
  audit, canaries, legacy proof, cleanup, and zero-agent counters.

## Application Flow

1. `verify-qualification.mjs --offline` verifies the pinned inputs and emits a
   deterministic `qualification-input-lock.json` that binds the runner commit
   and entrypoint, US-105 corpus/rubric runner, all US-106 treatments, and the
   fake execution environment.
2. The planner expands frozen canaries and rejects atomic dependencies.
3. The fixture materializer creates a fresh one-commit US-105 start.
4. The US-106 materializer stages/applies one candidate through shared policy;
   its candidate/manifest receipt identities must match the planned treatment.
5. A pre-run snapshot captures content and state identities.
6. An offline scripted adapter returns the declared success/failure/timeout/
   telemetry scenario; no provider/agent adapter is imported or resolved.
7. The raw store captures process state, stdout/stderr, workspace diff/tree,
   tests, metrics, and immutable first output.
8. The frozen rubric runner produces the fixed-denominator receipt.
9. Status precedence assigns primary outcome: setup/timeout/process/identity/
   rubric invalidity overrides probe success.
10. The entire cell process tree is terminated and reaped, the cell is
    destroyed, and absence of descendant-process and workspace state is
    verified before another atomic task begins.
11. Aggregation reads only checksum-verified raw artifacts and compares an
    independently reconstructed result with the recorded aggregate.
12. Receipt publication occurs only after all canaries, dependency disposition,
    legacy-boundary, cleanup, and zero-agent checks pass.

## Interface Contract

Expected entrypoint:

```text
node benchmark/evaluation/verify-qualification.mjs --offline --repository-harness-root <path>
```

`--output-root <path>` may redirect the five evidence files for repeatability
verification. Output-root paths and transient wall durations are excluded from
canonical identities, so equivalent runs produce byte-identical artifacts.

Expected evidence:

```text
benchmark/evaluation/evidence/qualification-input-lock.json
benchmark/evaluation/evidence/raw-cells.json
benchmark/evaluation/evidence/qualification-aggregate.json
benchmark/evaluation/evidence/dependency-audit.json
benchmark/evaluation/evidence/qualification-receipt.json
```

Equivalent names require one atomic update to this packet, repository parent
`US-108`, and `scripts/verify-e13-us108.sh`.

Raw cells use the repository-parent identity contract: runner; immutable
fixture; task/prompt/rubric/denominator; candidate manifest/materialization/
application; model/provider/runtime/agent/reasoning; sandbox/tools/pricing;
repetition/order/time/timeout/correction; and raw process/output/workspace/test/
rubric/measurement fields. Offline qualification identities are explicit (for
example, scripted adapter and not-applicable pricing), never fabricated live
provider versions.

Cleanup evidence does not assert that a mutable present-day directory must
remain absent forever. It records a SHA-256 proof over the named
`benchmark/evaluation/decision-runs` path, the pinned runner commit/tree, and
the path's absence in that commit tree. The current pre-Gate-D absence is an
informational generation observation; future legitimate Gate-D outputs do not
invalidate historical qualification evidence.

## Status And Denominator Precedence

```text
input/setup invalid
  > timeout or process failure
  > identity/contamination invalid
  > missing/unused rubric
  > critical rubric failure
  > complete fixed-denominator rubric result
```

A lower row cannot override a higher failure. Every declared check remains in
the denominator. Candidate-specific adherence may be attached as diagnostic
data only after primary outcome is fixed.

## Raw Aggregation

- Persist each raw cell atomically before aggregation.
- Address cells by checksum; require every declared cell ID exactly once and
  reject missing, duplicate, undeclared, or checksum-modified expected cells.
- Retain failed/invalid cells and fixed denominators.
- Preserve known/unknown measurement state.
- Recompute from raw artifacts in a separate pass and compare checksums.
- Emit canary aggregates only; no candidate score, comparison, margin, rank, or
  winner.

## Dependency Audit

Run `npm audit --json` against the exact lock. For each baseline advisory,
record package path, affected API/server path, qualification commands, claimed
platforms, reachability evidence, and disposition. Upgrade/remove reachable
findings and rebaseline runner-affecting identities, or prove the path
unreachable. A Windows claim separately addresses the Vite Windows findings.
Reachable or unexplained high/critical exposure blocks completion.

## UI / Platform Impact

No UI changes. The new surface is an evaluation-only Node command. It may claim
only hosts/platforms whose command and dependency exposure are qualified.

## Observability

All process transitions, raw outputs, workspace changes, test/rubric receipts,
measurement completeness, cleanup, canary dispositions, and dependency facts
are checksummed. Error messages name the exact cell/invariant. No Harness
database, story, or trace is a primary scoring requirement.

## Alternatives Considered

1. Patch legacy reports in place: rejected because it risks rewriting historical
   evidence and candidate-specific assumptions.
2. Wholesale runner rewrite: rejected until a focused boundary spike proves it
   necessary for one named criterion.
3. Live model smoke: rejected because qualification is deterministic and Gate D
   has not authorized paid behavior.
4. Omit unavailable metrics: rejected because telemetry absence would look like
   efficiency.
