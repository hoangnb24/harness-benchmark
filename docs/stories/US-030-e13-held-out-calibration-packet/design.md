# US-030 E13 Held-Out Calibration Packet — Design

## Domain Model

- **Held-out task**: H01 or H02; `decisionCorpusEligible` is false in both the
  catalog and corpus lock.
- **Calibration block**: one task/repetition and all three treatments in one
  contiguous order.
- **Calibration packet**: checksum map plus pending approval/execution
  templates. It carries no live authority.
- **Blinded observation**: task, block, local position, opaque treatment label,
  correctness/proof proportions, and typed telemetry.
- **Sizing blocker**: no repetition count is emitted when required telemetry,
  infrastructure validity, packet integrity, or a human ceiling is absent.

## Fixture And Execution Flow

The fixture generator uses only a sanitized Git environment: `PATH`, C locale,
fixed identity/date, disabled system/global configuration, null hooks, and
disabled commit signing. H02 writes tracked files, makes the deterministic root
commit, then writes `LOCAL_PATCH.md`. The materializer subsequently applies one
of the three checksum-pinned candidates. The existing US-029 executor performs
one call and destroys the workspace. Eighteen cells run sequentially; there is
no retry path.

## Statistical Contract

The six task/repetition blocks form two task-local 3x3 Latin squares. For each
endpoint, the blinded analysis fits the additive residual decomposition
`task*treatment + task:block + task:position`. Rank is 14 for 18 observations,
so the pooled residual degrees of freedom are exactly 4.

Correctness and proof use proportions. Input tokens use `ln(inputTokens)`;
cached input is already a subset and is not added. Wall time uses `ln(ms)`,
tool loops use `ln(max(1, loops))`, and credits use `ln(planCredits)`. Each
endpoint freezes its purpose, family alpha, planning threshold/value, transformed
gap, precision half-width, and positive variance floor. The variance upper
bound is `max(floor, SSE / chiSquareQuantile(0.05/6, 4))`.

The precision and power denominator is `K * gap^2`. Correctness and proof use
`K=2`, the minimum independently seeded tasks allowed to support each required
task-class claim. Input-token material benefit and the three operational
guardrails use all `K=16` atomic decision tasks. Using 16 for the class-level
non-inferiority endpoints would make their required repetition count eight
times too optimistic.

The raw requirement is the maximum precision/power requirement across the six
endpoints and 6. The only permitted rounding is
`R = 6 * ceil(raw / 6)`; the result is never capped downward. Unknown required
telemetry yields a blocker and no R. Diagnostic cached/output tokens may remain
typed unknown. USD must remain typed unknown for ChatGPT-plan mode.

The 40-credit planning value is the conservative upper end of a published
average range, not a debit, cap, or per-call maximum. A one-call overshoot is
possible. The projection covers 16 atomic tasks x 3 treatments plus one
cumulative journey x 3 treatments x 3 steps per repetition (57 calls). It
excludes ablations; Gate D must separately budget them or approve an E13
amendment.

## Isolation Contract

`calibration-report` and `calibration-verify` write/read only
`calibration-only/aggregate.json`. Ordinary decision `report` and `verify`
reject run ID `e13-gate-d0-calibration-v4`. The aggregate retains per-metric
known/unknown counts and marks calibration evidence ineligible for both the
decision corpus and aggregate.

## Alternatives Considered

1. Pool around three treatment means. Rejected because it ignores paired task,
   block, and order structure and overstates residual degrees of freedom.
2. Accept zero observed variance. Rejected because 18 calls cannot establish
   zero provider variance; every endpoint has a positive frozen floor.
3. Fill in a credit ceiling. Rejected because only a human approver owns that
   limit.
4. Reuse ordinary aggregate/report commands. Rejected because calibration
   evidence must be mechanically excluded from decision evidence.
