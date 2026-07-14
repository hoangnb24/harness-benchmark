# US-030 E13 Held-Out Calibration Packet — Exec Plan

## Goal

Produce a deterministic offline Gate D0 packet and proof without invoking an
installed Codex CLI, provider, network, API billing, paid credits, or ChatGPT
quota.

## Scope

In scope:

- Two held-out fixtures and fixed rubrics.
- Three frozen E13 candidate identities.
- Six balanced contiguous blocks and exactly 18 planned calls.
- Calibration-only aggregate/report boundaries.
- Blinded endpoint-specific sizing and blocker rules.
- SHA-256 packet generation, verification, and tamper tests.

Out of scope:

- Human Gate D0 approval or a credit ceiling.
- Live calibration or decision execution.
- Final Gate D protocol, ablation budget, or US-110.

## Risk Classification

Risk flags: external system, existing runner behavior, weak provider-variance
proof, public decision contract, and multi-domain statistical/credit rules.

Hard gates: no live call before exact human approval; calibration cannot enter
decision evidence; validation and variance floors cannot be weakened after
results exist.

## Work Phases

1. Bind the US-029 commit and candidate/materializer identities.
2. Freeze H01/H02, including H02's post-commit dirty baseline.
3. Freeze the exact alternating six-block schedule.
4. Add isolated aggregation and blinded sizing.
5. Generate and verify the packet lock.
6. Prove deterministic Git behavior, tamper rejection, schedule balance,
   blinded-label invariance, variance floor, endpoint separation, upward
   rounding, and blocker cases with local stubs/tests.
7. Complete independent review, register the offline verifier, and atomically
   mark the durable story implemented only after fresh proof passes.

## Stop Conditions

Stop without execution if any checksum differs, a fixture is not reproducible,
H02 is not dirty exactly as frozen, a call is missing/reordered/retried, an
infrastructure failure occurs, required telemetry is unknown, a report leaks
treatment information, a human ceiling is absent/insufficient, or any template
claims approval/live/US-110 authority.
