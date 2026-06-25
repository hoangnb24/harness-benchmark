# Agent Instructions

This repository is a benchmark target and runner. Treat `src/` as the application under test and
`benchmark/` as the benchmark harness.

## Primary Commands

- Install dependencies: `npm ci`
- Validate orchestrator changes:
  `npm run lint:orchestrator && npm run typecheck:orchestrator && npm test`
- Run the app during task work: `npm run dev`
- Run the benchmark CLI through npm: `npm run harness-bench -- <command>`

## Benchmark Workflow

Use the TypeScript orchestrator for new benchmark work:

```bash
npm run harness-bench -- pricing validate --pricing benchmark/pricing/models.json
npm run harness-bench -- run --dry-run --run-id RUN --run-dir benchmark/runs/RUN --model MODEL
npm run harness-bench -- run --execute --run-id RUN --run-dir benchmark/runs/RUN --workspace "$PWD" --agent codex --model MODEL
npm run harness-bench -- report generate --run-id RUN --run-dir benchmark/runs/RUN
```

The legacy Bash runner still exists for historical comparison:

```bash
./benchmark/run.sh --agent codex --harness main --run-id RUN
```

## Resume And Retry

Runs write `benchmark/runs/<run-id>/state.json` and workspace checkpoints under
`benchmark/runs/<run-id>/checkpoints/`.

```bash
npm run harness-bench -- run --execute --resume RUN --run-dir benchmark/runs/RUN --workspace "$PWD"
npm run harness-bench -- run --execute --resume RUN --run-dir benchmark/runs/RUN --workspace "$PWD" --only T5-bug-fix --force
npm run harness-bench -- run --dry-run --resume RUN --run-dir benchmark/runs/RUN --retry-failed
```

## Pricing And Usage

- Committed model rates live in `benchmark/pricing/models.json`.
- Private local overrides go in `benchmark/pricing/models.local.json`; this file is ignored by git.
- A missing model fails startup unless `--allow-missing-pricing` is passed, which records null cost.
- Per-task usage is written to `usage.json`; compatibility totals are written to `tokens.json`.

## Harness-Adherence Review

Score fixture evidence:

```bash
npm run harness-bench -- adherence score --evidence evidence.json --out adherence.json
```

Collect read-only Phase 5 harness evidence:

```bash
npm run harness-bench -- adherence collect --cwd "$PWD" --trace-id TRACE --out benchmark/runs/RUN/TASK/adherence.json --log benchmark/runs/RUN/TASK/events.jsonl
```

Use `--allow-missing-commands` when intentionally scoring a pre-Phase-5 harness ref; missing review
commands should reduce adherence rather than fail collection.

## Important Files

- `benchmark/PROTOCOL.md` describes benchmark rules, measured outputs, resumability, and scoring.
- `benchmark/tasks/manifest.json` defines T1-T12 task order and dependencies.
- `benchmark/orchestrator/` contains the TypeScript runner using domain/application/ports/infrastructure layers.
- `benchmark/upgrade-plan/README.md` records the completed upgrade plan and implementation evidence.

Do not commit generated local run artifacts unless the run result is explicitly part of the requested
deliverable.
