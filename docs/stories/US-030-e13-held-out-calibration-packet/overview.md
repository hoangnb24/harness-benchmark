# US-030 E13 Held-Out Calibration Packet — Overview

## Status

Implemented and independently reviewed as an offline, approval-ready template.
Gate D0 is not approved, live calibration is not authorized, and US-110
remains unauthorized.

## Current Behavior

US-029 pins and gates the decision runner, but it intentionally supplies no
held-out tasks, calibration schedule, blinded sizing rule, or human-approved
credit ceiling. Its generic report path could also report a calibration-scoped
plan without distinguishing that output from decision evidence.

## Target Behavior

The packet under `benchmark/calibration/e13/` binds the exact US-029 commit,
three candidate manifests, two held-out fixtures, their prompts and rubrics,
the materializer, the 18-call schedule, analysis code, aggregate code, CLI
entrypoint, and package lock with SHA-256.

H01 is a clean configuration-precedence repair. H02 is a brownfield script
merge whose correct `LOCAL_PATCH.md` is written only after the fixture commit;
therefore `git status --short` is exactly `?? LOCAL_PATCH.md` before any
treatment is applied. Its rubric requires that file and the local check script
to remain byte-for-byte unchanged.

The six contiguous blocks alternate tasks and use `ABC, ACB, BCA, CBA, CAB,
BAC`. Each task sees every treatment in every local position once. Calls are
sequential, retries are zero, and any infrastructure failure invalidates the
calibration aggregate.

## Cause And Effect

1. Calibration plans use only H01/H02, so held-out results cannot enter the
   Phase 0 decision corpus.
2. Calibration aggregates live at `calibration-only/aggregate.json`; ordinary
   `report` and `verify` reject this packet's run ID.
3. Missing required sizing telemetry produces no repetition count. Missing or
   insufficient human credit ceiling produces an evidence-design blocker.
4. The approval and execution templates contain no executable, model, elapsed
   limit, human ceiling, approval hash, or authority. A maintainer must supply
   and approve those exact identities in the repository-harness Gate D0 record.

## Affected Users

- E13 maintainers reviewing Gate D0.
- Benchmark operators who may execute only after separate exact approval.
- Independent reviewers consuming the treatment-blinded sizing report.

## Non-Goals

- No Codex/provider/network/API/paid/live invocation.
- No candidate means, effects, ranks, or selection.
- No final Gate D repetition or credit decision.
- No authorization for Gate D, US-110, ablations, or production changes.
