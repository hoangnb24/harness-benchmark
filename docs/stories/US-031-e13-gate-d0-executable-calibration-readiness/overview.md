# US-031 E13 Gate D0 Executable Calibration Readiness — Overview

## Status

Implemented and independently reviewed as offline readiness work. This story
does not approve Gate D0 and does not authorize a Codex or provider call.

## Problem

US-030 proved the held-out corpus, schedule, and sizing formulas, but its
execution contract is still a null-filled template. Four concrete gaps prevent
safe approval:

1. Calibration code exists at US-030 commit `efe0ba9`, while the validator
   still labels the runner as the older US-029 base commit `2013dd5`.
2. The general runner continues to later independent cells after a failed or
   invalid calibration cell.
3. `calibration-report` writes an aggregate but does not map raw evidence into
   the frozen treatment-blinded sample-size report.
4. The calibration execution-credit stop and the projected future-decision
   planning-credit ceiling are different limits, but the draft protocol does
   not yet carry both independently.

## Target Behavior

The benchmark can build and verify one exact 18-cell calibration plan using
the real execution commit, a checksum-pinned local environment, and a separate
external authorization artifact without a hash cycle. Calibration execution
stops after the first failed, invalid, or required-telemetry-incomplete cell.
The retained receipt records exactly how many calls were attempted and why
admission stopped.

After 18 valid cells, an offline report command maps effective rubric checks to
separate correctness and proof proportions, retains opaque treatment labels
only internally, overlays a separately authorized future-decision planning
ceiling in memory, and writes the frozen blinded sizing result. It never emits
candidate labels, means, ranks, effects, eligibility, or candidate selection.
It may emit the mechanically selected balanced repetition count because that is
the purpose of blinded sizing, not a candidate decision.

## Cause And Effect

- Supplying the post-US-031 execution commit through the external governance
  input means evidence names the exact code that will execute without making
  the packet hash itself.
- Keeping `2013dd5` only as an ancestor proves US-030 extends the qualified
  runner without pretending that the older tree contains calibration code.
- Fail-fast admission prevents a broken calibration from consuming the rest
  of the approved quota.
- A separate future-decision ceiling lets the sizing formula evaluate
  `40 * 57 * R` without confusing that projection with the 18-call execution
  stop.
- A cycle-free plan-core digest lets a human approve exact bytes: governance
  and environment feed the plan core, authorization hashes the core, and the
  final plan hashes the authorization. Nothing upstream hashes the final plan.

## Non-Goals

- No live Codex/provider/network execution.
- No Gate D0 or Gate D approval.
- No treatment unblinding, eligibility, ranking, or selection.
- No US-110 decision run.
