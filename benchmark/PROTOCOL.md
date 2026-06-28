# Benchmark Protocol

## Purpose

This benchmark measures whether harness-experimental improves AI agent productivity on real development tasks. The same manifest-driven task suite is executed against different harness versions, agents, and models, and results are compared objectively.

## Rules

1. **No manual intervention** during a run. The script starts, the agent works, the script scores.
2. **Same prompts every time**. Task files in `benchmark/tasks/` are the exact input.
3. **Fresh project state** per run. Reset to `benchmark-v1` tag before each run.
4. **Same model** across comparison runs. Pin with `--model` flag.
5. **Sequential execution by manifest**. Tasks run in `benchmark/tasks/manifest.json` order. Filesystem changes persist between tasks.
6. **No conversation context**. Each task is a fresh agent invocation.
7. **Pricing must be explicit**. A requested model must exist in `benchmark/pricing/models.json` unless the run is explicitly allowed to record null cost.

## What Gets Measured

### Per Task
- **Wall time** (seconds): How long the agent took
- **Token usage**: Per-interaction usage from provider-specific JSON output
- **Exit code**: Success (0) or failure type (1-4, 124=timeout)
- **Functional score**: Automated API endpoint tests (pass/fail)
- **Harness compliance**: Did the agent use the harness durable layer?
- **Harness adherence**: Did Phase 5 review evidence show good tool, verification, intervention, context, entropy, and proposal behavior?
- **Quality score**: Depth of trace entries and documentation

### Aggregated
- **Total wall time**: Sum of all task times
- **Total token cost**: Estimated USD from token counts
- **Functional pass rate**: Total functional checks passed / total checks
- **Harness compliance rate**: Harness checks passed / total harness checks
- **Average trace quality**: 1 (minimal) to 3 (detailed)
- **Lane accuracy**: Correct risk classifications / task count
- **Harness adherence score**: Adherence checks passed / total checks

## Run Lifecycle

Legacy Bash runs still use:

```
1. prepare.sh   → Install harness from specified git ref
2. For each task:
   a. invoke.sh  → Run agent, capture output + timing
   b. check-functional.sh → Test API endpoints
   c. check-harness.sh → Query harness.db
   d. check-quality.sh → Assess trace depth
3. report.sh    → Aggregate into scores.json + report.md
```

The TypeScript orchestrator uses:

```bash
npm run harness-bench -- run --dry-run --run-id RUN --run-dir benchmark/runs/RUN --harness main --model gpt-5.4
npm run harness-bench -- run --execute --run-id RUN --run-dir benchmark/runs/RUN --workspace "$PWD" --harness main --agent codex --model gpt-5.4
npm run harness-bench -- report generate --run-id RUN --run-dir benchmark/runs/RUN
```

For a fresh execution run from a git workspace, it mirrors the legacy Bash isolation model:
clone the workspace to `/tmp`, execute there, and copy only `benchmark/runs/RUN` back to the
requested run directory. Use `--no-isolate` to intentionally run in the provided workspace.

Inside the execution workspace, it first invokes `benchmark/lib/prepare.sh` to install Harness
from the requested `--harness` ref. That legacy prepare path clones or fetches
`repository-harness`, checks out the target ref, builds `crates/harness-cli` with Cargo, installs
that locally built `scripts/bin/harness-cli`, and runs the checked-out installer in merge mode.
It then runs the manifest tasks and writes `state.json`, per-task `timing.json`,
`functional.json`, `harness.json`, `quality.json`, `lane.json`, `usage.json`, compatibility
`tokens.json`, workspace checkpoints under `checkpoints/`, and regenerated `scores.json` /
`report.md`.

## Resumable Runs

The TypeScript orchestrator supports resumable planning and execution:

```bash
npm run harness-bench -- run --dry-run --resume RUN --run-dir benchmark/runs/RUN
npm run harness-bench -- run --execute --resume RUN --run-dir benchmark/runs/RUN --workspace "$PWD"
npm run harness-bench -- run --execute --resume RUN --run-dir benchmark/runs/RUN --workspace "$PWD" --only T5-bug-fix --force
```

| Flag | Behavior |
| --- | --- |
| `--resume RUN` | Continue from the first non-passed/non-skipped step |
| `--only TASK` | Run one task from its prior checkpoint; passed tasks require `--force` |
| `--from TASK` | Run from a selected task through the end |
| `--steps T3,T5` | Run an explicit subset |
| `--retry-failed` | Run failed retriable steps |

Checkpoints are copied with an explicit exclusion policy for dependencies, run artifacts, nested checkpoints, and transient SQLite/cache files.

## Usage and Cost

`benchmark/pricing/models.json` is the committed manual pricing table. For private experiments,
`benchmark/pricing/models.local.json` can override or add models locally; it is ignored by git and
is merged over the committed table by `harness-bench pricing validate` and run startup. Run startup
fails when `--model` is missing from the effective table unless `--allow-missing-pricing` is
supplied. Provider parsers normalize OpenAI/Codex, Anthropic/Claude, and custom `usage.json` outputs
into per-interaction records.

## Harness-Adherence Review

Phase 5 review evidence can be scored from a JSON fixture:

```bash
npm run harness-bench -- adherence score --evidence evidence.json --out adherence.json
```

Or collected from read-only harness review commands:

```bash
npm run harness-bench -- adherence collect --cwd "$PWD" --trace-id TRACE --out benchmark/runs/RUN/T1/adherence.json --log benchmark/runs/RUN/T1/events.jsonl
```

The collection command runs `query tools --json`, `story verify-all --json`, `query interventions --json`, `score-context`, `audit --json`, and `propose --json`, then feeds the normalized evidence into the deterministic adherence scorer.

## Comparing Runs

```bash
./benchmark/compare.sh <run-id-1> <run-id-2>
```

Reads `scores.json` from both runs and outputs a side-by-side diff table
followed by **component-level attribution**.

### Component Attribution (US-014)

When score deltas exist between runs, the comparison script attributes each
change to one of the 11 Runtime Substrate responsibilities from
`HARNESS_COMPONENTS.md`. Attribution works at two levels:

**Harness compliance checks** — each check maps to a responsibility:

| Check | Responsibility |
|-------|---------------|
| `intake_recorded` | Task specification |
| `correct_lane` | Task specification |
| `story_created` | Task state |
| `high_risk_docs` | Task specification |
| `decision_recorded` | Intervention recording |
| `trace_recorded` | Observability |
| `friction_captured` | Failure attribution |

**Trace quality fields** — each field maps to a responsibility:

| Field | Responsibility |
|-------|---------------|
| `task_summary`, `agent`, `actions_taken`, `duration_or_note`, `token_estimate_or_note` | Observability |
| `outcome`, `files_changed` | Task state |
| `files_read` | Context selection |
| `errors_or_friction`, `errors_explicit`, `friction_explicit` | Failure attribution |
| `decisions_made` | Intervention recording |

The output shows per-task deltas (e.g. `friction_captured: ✗→✓ (Failure
attribution)`) and a responsibility summary with net direction (↑ improved /
↓ regressed / ~ mixed).

For runs using the older `quality.json` format (length-based fields), the
script falls back to comparing `trace_quality_score` as a whole, attributed
to Observability.

## Expected Results Per Phase

| Metric | Baseline (main) | After Phase 2 | Delta |
|--------|----------------|---------------|-------|
| Functional score | ~70-85% | ~70-85% | ~0% (Phase 2 is docs, not code quality) |
| Harness compliance | ~20-40% | ~60-80% | **+30-40%** |
| Trace quality | 1.0-1.5 | 2.0-2.5 | **+1.0** |
| Lane accuracy | ~50% | ~80-100% | **+30-50%** |
| Wall time | ~X min | ~X+5% min | Slight increase (more harness steps) |
| Token cost | ~$Y | ~$Y+10% | Slight increase (reading more docs) |

Phase 2 should NOT improve functional score (the code quality comes from agent capability, not harness docs). It SHOULD improve compliance, quality, and lane accuracy.

## Failure Modes

| Situation | Handling |
|-----------|----------|
| Agent times out | Record timeout as retriable, score functional=0, continue/resume |
| Agent produces broken code | Functional checks fail, harness checks may partially pass |
| Server won't start | All functional checks fail with "server_start_failed" |
| Auth not working (T5/T6) | Those checks fail; still a valid measurement |
| Harness DB doesn't exist | All harness checks = 0 (agent didn't use harness) |

## Reproducibility

To reproduce a run:
1. Checkout `benchmark-v1` tag
2. Use same `--model` flag
3. Use same harness ref
4. Use the same `benchmark/pricing/models.json` version
5. Token costs should be reproducible for the same captured provider usage and pricing table
6. Functional results should be deterministic (same code → same API behavior)
