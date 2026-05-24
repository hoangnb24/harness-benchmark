# Benchmark Protocol

## Purpose

This benchmark measures whether harness-experimental improves AI agent productivity on real development tasks. The same 6 tasks are executed against different harness versions, and results are compared objectively.

## Rules

1. **No manual intervention** during a run. The script starts, the agent works, the script scores.
2. **Same prompts every time**. Task files in `benchmark/tasks/` are the exact input.
3. **Fresh project state** per run. Reset to `benchmark-v1` tag before each run.
4. **Same model** across comparison runs. Pin with `--model` flag.
5. **Sequential execution**. Tasks run T1→T6 in order. Filesystem changes persist between tasks.
6. **No conversation context**. Each task is a fresh Codex `exec` session.

## What Gets Measured

### Per Task
- **Wall time** (seconds): How long the agent took
- **Token usage**: Input/output/cached tokens from Codex JSONL
- **Exit code**: Success (0) or failure type (1-4, 124=timeout)
- **Functional score**: Automated API endpoint tests (pass/fail)
- **Harness compliance**: Did the agent use the harness durable layer?
- **Quality score**: Depth of trace entries and documentation

### Aggregated
- **Total wall time**: Sum of all task times
- **Total token cost**: Estimated USD from token counts
- **Functional pass rate**: Total functional checks passed / total checks
- **Harness compliance rate**: Harness checks passed / total harness checks
- **Average trace quality**: 1 (minimal) to 3 (detailed)
- **Lane accuracy**: Correct risk classifications / 6

## Run Lifecycle

```
1. prepare.sh   → Install harness from specified git ref
2. For each T1-T6:
   a. invoke.sh  → Run Codex exec, capture JSONL + timing
   b. check-functional.sh → Test API endpoints
   c. check-harness.sh → Query harness.db
   d. check-quality.sh → Assess trace depth
3. report.sh    → Aggregate into scores.json + report.md
```

## Comparing Runs

```bash
./benchmark/compare.sh <run-id-1> <run-id-2>
```

Reads `scores.json` from both runs and outputs a side-by-side diff table.

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
| Agent times out (10 min) | Record timeout, score functional=0, continue |
| Agent produces broken code | Functional checks fail, harness checks may partially pass |
| Server won't start | All functional checks fail with "server_start_failed" |
| Auth not working (T5/T6) | Those checks fail; still a valid measurement |
| Harness DB doesn't exist | All harness checks = 0 (agent didn't use harness) |

## Reproducibility

To reproduce a run:
1. Checkout `benchmark-v1` tag
2. Use same `--model` flag
3. Use same harness ref
4. Token costs may vary slightly due to caching and model behavior
5. Functional results should be deterministic (same code → same API behavior)
