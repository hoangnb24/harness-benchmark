# Harness Benchmark

A controlled benchmark for measuring the effectiveness of [harness-experimental](https://github.com/hoangnb24/harness-experimental) across development phases.

## What This Is

A pre-seeded TypeScript/Express project with **6 fixed tasks** (T1–T6) that an AI agent executes. The benchmark measures time, token cost, code quality, and harness compliance. By re-running after each harness phase, we objectively measure whether the harness improved agent productivity.

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
# Baseline run (against harness main branch)
./benchmark/run.sh --agent codex --harness main --run-id baseline

# Phase 2 run (against feature branch)
./benchmark/run.sh --agent codex --harness phase-2/observability-taxonomy --run-id phase-2

# Compare results
./benchmark/compare.sh baseline phase-2
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
│   ├── run.sh                # Main orchestrator script
│   ├── compare.sh            # Compare two run results
│   ├── tasks/                # Task prompts (T1-T6.md)
│   ├── rubrics/              # Objective scoring checklists
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
2. **Install harness** from target ref (main, feature branch)
3. **Run T1–T6** sequentially via Codex CLI
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

## Metrics

| Metric | What It Measures | Source |
|--------|-----------------|--------|
| Wall time | Speed of completion | `timing.json` |
| Token cost | API cost efficiency | `tokens.json` (from Codex JSONL) |
| Functional score | Does the code work? | `check-functional.sh` (curl tests) |
| Harness compliance | Did the agent use the harness? | `check-harness.sh` (sqlite3 queries) |
| Trace quality | How detailed are the traces? | `check-quality.sh` |
| Lane accuracy | Correct risk classification? | `lane.json` |

## License

MIT
