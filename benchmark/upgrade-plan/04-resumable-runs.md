# Workstream 04 — Resumable / retryable runs

> Addresses request #4: *"Retry-able capabilities, we should be able to continue from our last failed
> step or re-run a step. Sometimes we hit an unwanted issue like out of credits or network connection
> which affects the run. Instead of re-running from the beginning, we can run from the desired test."*

## Problem

`benchmark/run.sh` runs a **linear, stateless** loop:

```bash
TASKS=(T1-project-setup T2-crud-bookmarks T3-folder-support T4-authentication T5-bug-fix T6-pagination)
for task in "${TASKS[@]}"; do
  mkdir TASK_DIR; record_harness_baseline; invoke_agent; check_functional; check_harness; check_quality
done
generate_report
```

There is **no checkpoint**: if T5 fails (out of credits, network drop, timeout=124), the entire
~1500s / ~$19 run is wasted and must restart at T1. The `benchmark/seeds/` directory was clearly
intended for this ("Checkpoint states for partial re-runs", per `README.md`) but is **empty**
(`benchmark/seeds/.gitkeep`).

Because tasks are **stateful and cumulative** (T4 auth builds on the T2/T3 API, the harness `harness.db`
accrues across tasks), resuming requires restoring the *workspace + harness db* as they were at the
end of the last good step — not just re-running a command.

## Proposed design

### A. Run-state machine persisted to `state.json`

```jsonc
// benchmark/runs/<run-id>/state.json
{
  "runId": "...", "agent": "codex", "model": "gpt-5-codex", "harnessRef": "main",
  "workspaceDir": "/tmp/harness-benchmark-...-codex-...",
  "pricingVersion": "2026-06-13",
  "steps": [
    { "task": "T1-project-setup", "status": "passed",  "startedAt": "...", "endedAt": "...",
      "checkpoint": "checkpoints/T1", "failureClass": null },
    { "task": "T2-crud-bookmarks", "status": "failed", "failureClass": "retriable",
      "exitCode": 124, "detail": "agent timeout" },
    { "task": "T3-folder-support", "status": "pending" }
  ]
}
```

`StepStatus ∈ { pending, running, passed, failed, skipped }`. State is written **atomically**
(write temp file + `rename`) on every transition so a crash mid-write cannot corrupt it.

### B. Per-step checkpoints (what `seeds/` becomes, per run)

Before T1 and after each **passed** step, snapshot the resumable state into
`benchmark/runs/<run-id>/checkpoints/<task>/`:

- the project workspace **excluding transient/generated paths** (cheap; restored with `npm ci` on
  resume), and
- a copy of `harness.db`, plus the `harness-baseline.env` for the next step.

The pre-T1 checkpoint is required so `--only T1`, `--from T1`, and a failed T1 retry have a clean
restore point after harness installation but before agent work.

Minimum checkpoint exclusion list:

- `node_modules`
- `benchmark/runs/<run-id>/checkpoints`
- other copied-back run artifacts for the same run (`events.jsonl`, `server.log`, reports, scores)
- application transient files that should not define resumable state (`data.db-wal`, `data.db-shm`)
- package/build caches that can be recreated

The implementation should prefer an explicit allow/exclude policy over a blind recursive copy. A
parity test must verify that a resumed run and a linear run see the same files before the resumed task
starts.

Resuming "to run step K" restores the checkpoint produced by step **K-1**, guaranteeing K starts from
exactly the state it would have had in a clean linear run.

### C. CLI surface (added to `run.sh` / the new `cli.ts`)

| Flag | Behavior |
| --- | --- |
| `--resume <run-id>` | Load `state.json`; skip `passed` steps; restore the last good checkpoint; continue at the first non-passed step |
| `--only <task>` | Restore the checkpoint *before* `<task>` and run **only** that step (re-run a single test) |
| `--from <task>` | Restore the checkpoint before `<task>` and run from there to the end |
| `--steps T3,T5` | Run an explicit subset, each from its prior checkpoint |
| `--retry-failed` | Re-run only steps whose status is `failed` |
| `--force` | Allow re-running a `passed` step (otherwise a no-op) |

### D. Failure classification (makes "retry" meaningful)

The `AgentAdapter` + `UsageParser` (Workstreams 01/03) classify a failed step as:

- **`retriable`** — agent exit 124 (timeout), network errors, or provider quota/credit/auth errors
  detected in stderr / the usage payload (e.g. Anthropic `rate_limit_error`, OpenAI
  `insufficient_quota`); or
- **`fatal`** — the agent produced broken code / a check genuinely failed on merit.

`--retry-failed` targets `retriable` steps by default; re-running a `fatal` step requires naming it
explicitly (`--only`). This directly serves the "out of credits / network" scenario the user described.

### E. Idempotency & reporting

- Re-running a `passed` step without `--force` is a **no-op** (prints "already passed").
- `GenerateReport` reads `state.json`, so a report can be produced for a **partial** run and is
  regenerated after a resume completes the remaining steps.

## Acceptance criteria (testable)

| # | Criterion | How to verify |
| --- | --- | --- |
| 1 | Interrupt after T3 passes → `--resume <id>` starts at T4 and does **not** re-run T1–T3 | integration test inspects `state.json` + that T1–T3 dirs are untouched (mtime) |
| 2 | `--only T5` restores the post-T4 checkpoint and runs **only** T5 | T5 dir regenerated; T1–T4, T6 dirs unchanged |
| 3 | `--from T4` runs T4→T6 from the post-T3 checkpoint | steps T4–T6 re-run; T1–T3 skipped |
| 4 | A crash during a `state.json` write leaves the **last consistent** state loadable | unit test on atomic write (kill between temp-write and rename) |
| 5 | Re-running a `passed` step without `--force` is a no-op; with `--force` it re-runs | integration test both ways |
| 6 | A timeout (exit 124) and a simulated quota error are classified **`retriable`** | unit test over adapter classification with stderr fixtures |
| 7 | `--retry-failed` re-runs only `retriable` failed steps | integration test with mixed statuses |
| 8 | A report can be generated from a **partial** `state.json` | `GenerateReport` test on a partial run |
| 9 | Restored workspace reproduces the same functional checks as an uninterrupted run | parity test: resumed run scores == linear run scores |
| 10 | `--only T1` and `--from T1` restore the pre-T1 checkpoint | integration test confirms harness installed, no task artifacts present |
| 11 | Checkpoint creation does not recursively copy checkpoints or run artifacts | fixture workspace with nested checkpoint dir; snapshot excludes it |

## Touch points

- New: `benchmark/orchestrator/{domain/checkpoint.ts, application/ResumeRun.ts, ports/CheckpointStore.ts, infrastructure/FsCheckpointStore.ts}`; uses `benchmark/runs/<id>/{state.json,checkpoints/**}`.
- Repurposes: `benchmark/seeds/` (seed fixtures for Phase 5 tasks; per-run checkpoints live under the run dir).
- Updates: `benchmark/run.sh` loop + arg parsing, `benchmark/PROTOCOL.md` (resume/failure-mode section), `.gitignore` (ensure `state.json` + checkpoints are retained or ignored per policy).
