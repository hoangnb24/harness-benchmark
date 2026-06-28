# Harness Benchmark

A controlled benchmark for measuring the effectiveness of [harness-experimental](https://github.com/hoangnb24/harness-experimental) across development phases.

## What This Is

A pre-seeded TypeScript/Express project with **12 manifest-driven tasks** (T1–T12) that an AI agent executes. The benchmark measures time, token cost, functional behavior, harness compliance, trace quality, lane accuracy, and Phase 5 harness-adherence evidence. By re-running after each harness phase, we objectively measure whether the harness improved agent productivity.

## Quick Start

### Prerequisites

```bash
# Codex CLI (primary agent)
npm install -g @openai/codex
export OPENAI_API_KEY="sk-..."

# System dependencies
node --version  # v20+
jq --version    # for JSON parsing
sqlite3 --version  # for harness compliance checks
```

### Run the Benchmark

```bash
# Validate the committed pricing table before a paid run
npm run harness-bench -- pricing validate --pricing benchmark/pricing/models.json

# TypeScript orchestrator dry-run planning
npm run harness-bench -- run --dry-run --run-id baseline --run-dir benchmark/runs/baseline --harness main --model gpt-5.4

# TypeScript orchestrator execution
npm run harness-bench -- run --execute --run-id baseline --run-dir benchmark/runs/baseline --workspace "$PWD" --harness main --agent codex --model gpt-5.4

# Compare results
./benchmark/compare.sh baseline phase-2
```

The legacy Bash runner is still available for historical comparison:

```bash
./benchmark/run.sh --agent codex --harness main --run-id baseline
```

### Resume, Retry, And Report

The TypeScript orchestrator writes `state.json`, per-task checkpoints, `usage.json`, compatibility
`tokens.json`, `scores.json`, and `report.md` under `benchmark/runs/<run-id>/`.

```bash
# Continue from the first failed or pending step
npm run harness-bench -- run --execute --resume baseline --run-dir benchmark/runs/baseline --workspace "$PWD"

# Re-run one task from its prior checkpoint
npm run harness-bench -- run --execute --resume baseline --run-dir benchmark/runs/baseline --workspace "$PWD" --only T5-bug-fix --force

# Regenerate scores and markdown report
npm run harness-bench -- report generate --run-id baseline --run-dir benchmark/runs/baseline
```

### Pricing And Adherence

Model prices are read from `benchmark/pricing/models.json`. For private experiments, add
`benchmark/pricing/models.local.json`; it is ignored by git and overrides the committed table.

```bash
# Score recorded Phase 5 evidence
npm run harness-bench -- adherence score --evidence evidence.json --out adherence.json

# Collect read-only Phase 5 evidence from a harness workspace
npm run harness-bench -- adherence collect --cwd "$PWD" --trace-id TRACE --out benchmark/runs/baseline/T1-project-setup/adherence.json --log benchmark/runs/baseline/T1-project-setup/events.jsonl
```

### View Results

```bash
cat benchmark/runs/<run-id>/report.md     # Human-readable summary
cat benchmark/runs/<run-id>/scores.json   # Machine-readable scores
```

## Project Structure

```
harness-benchmark/
├── README.md                 # This file
├── PRODUCT_SPEC.md           # Product specification (what the agent builds)
├── package.json              # Pre-seeded dependencies (Express, better-sqlite3, vitest)
├── tsconfig.json             # TypeScript configuration
├── src/
│   └── index.ts              # Empty entrypoint (agent builds from here)
├── benchmark/
│   ├── PROTOCOL.md           # How runs work, what's measured, rules
│   ├── run.sh                # Legacy orchestrator script
│   ├── compare.sh            # Compare two run results
│   ├── tasks/                # Task prompts, manifest, and declarative checks (T1-T12)
│   ├── rubrics/              # Objective scoring checklists
│   ├── orchestrator/         # TypeScript runner, ports, adapters, and CLI
│   ├── lib/                  # Runner helper scripts
│   │   ├── prepare.sh        # Harness installation
│   │   ├── invoke.sh         # Agent invocation + telemetry
│   │   ├── check-functional.sh
│   │   ├── check-harness.sh
│   │   ├── check-quality.sh
│   │   └── report.sh
│   ├── runs/                 # Output directory (git-tracked results)
│   │   └── .gitkeep
│   └── seeds/                # Checkpoint states for partial re-runs
│       └── .gitkeep
```

## The Benchmark Cycle

1. **Tag** benchmark repo → `benchmark-v1`
2. **Install harness** from target ref (`main`, feature branch) and build the Rust CLI from that ref
3. **Run T1–T12** sequentially from `benchmark/tasks/manifest.json`
4. **Score** against objective rubrics
5. **Compare** to previous runs

Each phase must **earn its merge** by moving the numbers.

## Tasks Overview

| Task | Name | Risk Lane | What It Tests |
|------|------|-----------|---------------|
| T1 | Project Setup | tiny | Basic scaffolding, health endpoint |
| T2 | CRUD Bookmarks | normal | Core API implementation |
| T3 | Folder Support | normal | Feature addition on existing code |
| T4 | Authentication | high-risk | Complex feature with security implications |
| T5 | Bug Fix | normal | Diagnosis and targeted fix |
| T6 | Pagination | normal | Refactoring existing API responses |
| T7 | Tags | normal | Tagging and many-to-many API behavior |
| T8 | Search | normal | Full-text search behavior |
| T9 | Import / Export | normal | Bulk data movement |
| T10 | Folder Sharing | high-risk | Authorization boundaries |
| T11 | Concurrency Safety | normal | Conflicting writes and idempotency |
| T12 | Scale and Cursor Pagination | normal | Large result sets and cursor paging |

## Metrics

| Metric | What It Measures | Source |
|--------|-----------------|--------|
| Wall time | Speed of completion | per-task `timing.json` |
| Token cost | API cost efficiency | per-task `usage.json` and compatibility `tokens.json` |
| Functional score | Does the code work? | per-task `functional.json` |
| Harness compliance | Did the agent use the harness? | per-task `harness.json` from legacy scorer |
| Trace quality | How detailed are the traces? | per-task `quality.json` from legacy scorer |
| Lane accuracy | Correct risk classification? | per-task `lane.json` |
| Harness adherence | Phase 5 evidence quality | `adherence.json` from review commands |

## License

MIT
