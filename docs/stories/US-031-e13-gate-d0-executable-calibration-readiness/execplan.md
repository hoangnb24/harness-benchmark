# US-031 E13 Gate D0 Executable Calibration Readiness — Exec Plan

## Scope

1. Replace the false US-029 execution identity with a post-US-031 execution
   commit supplied through cycle-free governance while retaining US-029 as the
   explicit qualified ancestor.
2. Add canonical exact plan construction and offline validation.
3. Add calibration-only fail-fast execution and a retained run receipt.
4. Add raw-evidence-to-blinded-observation mapping and report generation.
5. Separate calibration execution limits from future-decision sizing limits.
6. Lock all new transitive code, policies, and tests into the packet.
7. Run independent review, full regression proof, durable story verification,
   and a smart commit before returning to root US-109.

## Stop Conditions

Stop without execution if any commit, path, checksum, policy, cell, schedule,
limit, approval, or absence proof differs. Stop implementation handoff if a
test can make a second invocation after the first invalid calibration record,
if report output can expose treatment identity/effects, or if a ceiling can be
silently reused for the wrong purpose.

## Authority Boundary

This story may create code and inert templates. It may not set a human limit,
claim approval, pass the live-execution flag, or run Codex. Root US-109 owns
the separate exact approval after this story is committed and independently
verified.
