# Benchmark Upgrade Plan

> Status: **Implemented** on `devin/1781350935-benchmark-upgrade-plan`.
> The branch now contains the TypeScript orchestrator, task manifest, provider usage/cost
> accounting, adherence review, checkpoint/resume support, docs, and CI validation.
> Target: `harness-benchmark` orchestrator + task suite.
> Motivation: `repository-harness` has reached **Phase 5 (Evolution Infrastructure)**, but this
> benchmark has not kept pace. Recent runs **max out** the metrics it measures, so it can no
> longer tell us whether the harness is actually getting better.

## 0. Plain-English objective

This upgrade exists because the benchmark is saturated. It can still prove that an agent can finish
the original Bookmark Manager tasks, but it no longer separates harness versions or agent quality:
recent runs hit 100% on functional checks, harness compliance, and lane accuracy.

The goal is to restore signal. After this upgrade, the benchmark should answer:

1. Which agent/model performs best on the same work, with accurate provider-specific token and cost
   accounting?
2. Does `repository-harness` Phase 5 leave useful evidence for audit, context scoring, intervention
   review, and improvement proposals?
3. Do harder tasks expose correctness, design, security, and scale differences that T1-T6 no longer
   expose?
4. Can an expensive long run resume from the last good checkpoint instead of starting over?
5. Can the runner keep evolving without adding more global-state Bash branches?

In short: keep T1-T6 as the historical baseline, then add enough accounting, resumability,
architecture, harder tasks, and Phase 5 review to make future benchmark numbers meaningful again.

## 1. Why now

The most recent run on record — `benchmark/runs/phase-5-evolution-infrastructure-20260608-230505/scores.json` —
shows the headroom problem clearly:

| Metric | Phase 5 run | Ceiling | Headroom |
| --- | --- | --- | --- |
| Functional checks | **37 / 37 (100%)** | 100% | none |
| Harness compliance | **31 / 31 (100%)** | 100% | none |
| Lane accuracy | **6 / 6 (100%)** | 100% | none |
| Avg trace quality | 2.1 / 3 | 3 | small |
| Wall / cost | 1504s / $18.83 | — | n/a |

Three of the five scored dimensions are pinned at 100%. At the same time, **none** of the
capabilities that define Phase 5 are exercised by the benchmark at all. The Phase 5 commands
shipped by `harness-cli` — verified present in `repository-harness/crates/harness-cli/src/interface.rs`:

- `query tools [--json|--summary|--responsibility <name>]`, `tool register`, `tool remove` (US-019)
- `story verify-all` (US-020)
- `intervention add`, `query interventions [--trace|--story|--type]` (US-021)
- `score-context <trace-id>` (US-022)
- `audit` → entropy score (US-023)
- `propose [--commit]` → structured improvement proposals (US-024)

…are **never invoked** by any task. The current functional checks (`benchmark/lib/check-functional.sh`)
are *all* HTTP probes against the Bookmark Manager API the agent builds; they say nothing about
whether the agent left enough durable evidence for the benchmark to **audit drift, score context,
review interventions, and generate improvement proposals** — which is the point of Phase 5 and
exactly what *"a previous benchmark can't do, and an agent without the benchmark can't do either."*

## 2. Goals

1. **Multi-agent / multi-model** runs with **provider-accurate usage and cost** accounting
   (OpenAI/codex, Anthropic/claude, custom), driven by a **manually-updatable pricing table**.
2. **New, harder tasks** plus a Phase 5 review layer. The agent should naturally leave high-quality
   harness evidence while doing implementation work; the benchmark then runs `score-context`,
   `audit`, `query interventions`, and `propose` as read-only measurement over that evidence.
3. A **pragmatic clean architecture** for the orchestrator: explicit layers, **dependency injection**,
   and clear macro boundaries (replacing the current sourced-Bash + global-variable design).
4. **Resumable / retryable runs**: continue from the last failed step, or re-run a chosen step,
   instead of restarting the whole ~25-minute / ~$19 run after an out-of-credits or network blip.

## 3. Non-goals

- We do not change the system-under-test (the Bookmark Manager API spec in `PRODUCT_SPEC.md`) except
  to *add* new task tiers; the existing T1–T6 remain the functional-correctness baseline.
- We do not change `repository-harness`.

## 4. Original-state assessment (what motivated each workstream)

| Area | Today | Evidence | Workstream |
| --- | --- | --- | --- |
| Agents | `codex` fully parsed; `claude` & `custom` write **zero** tokens | `benchmark/lib/invoke.sh:104-150` | [01](01-multi-agent-and-cost.md) |
| Cost | single hardcoded rate `$3/M in, $12/M out` for **all** models | `benchmark/lib/invoke.sh:174-176` | [01](01-multi-agent-and-cost.md) |
| Difficulty | T1–T6 mastered (37/37); no harder challenge tasks | latest `scores.json` | [02](02-phase5-capability-tests.md) |
| Harness adherence | logs/`harness.db` never reviewed; no Phase 5 adherence metric | `benchmark/lib/check-functional.sh` (all HTTP) | [02](02-phase5-capability-tests.md) |
| Architecture | sourced Bash + globals (`AGENT`, `RUN_ID`, …) | `benchmark/run.sh`, `benchmark/lib/*.sh` | [03](03-clean-architecture-and-di.md) |
| Resume | linear `for task in T1..T6`; no checkpoint; `seeds/` empty | `benchmark/run.sh:117-152`, `benchmark/seeds/.gitkeep` | [04](04-resumable-runs.md) |

## 5. Target macro architecture (one diagram, four workstreams)

All four workstreams assume the layered design in [03 — Clean architecture & DI](03-clean-architecture-and-di.md).
The dependency rule points **inward**; infrastructure (process spawning, sqlite, http, filesystem)
is injected into use cases through **ports**:

```
            interface/cli            ← arg parsing + composition root (wires DI)
                  │
            application/             ← use cases: RunBenchmark, ResumeRun, ScoreTask,
                  │                     GenerateReport, CompareRuns
        ┌─────────┼───────────────────────────────┐
      ports/                                    domain/
   (interfaces)                          (pure logic, no I/O):
   AgentAdapter        UsageParser       Task, RunPlan, TaskResult,
   PricingProvider     HarnessGateway    Score, UsageRecord, CostModel,
   FunctionalProbe     CheckpointStore   CheckpointState, ProviderUsage
   Clock  FileStore
        └─────────┬───────────────────────────────┘
            infrastructure/          ← implementations of the ports:
                                       CodexAdapter / ClaudeAdapter / CustomAdapter,
                                       OpenAiUsageParser / AnthropicUsageParser,
                                       SqliteHarnessGateway, HttpFunctionalProbe,
                                       JsonPricingProvider, FsCheckpointStore
```

- **Workstream 01** adds `AgentAdapter`, `UsageParser` (per provider), `PricingProvider`, and the
  `CostModel` domain logic.
- **Workstream 02** adds (a) more T1–T6-style challenge tasks and (b) a log/trace/`harness.db`
  **review** layer behind `HarnessGateway` (the benchmark runs `score-context`/`audit`/`propose` as
  read-only *measurement* of the agent's output) plus a new `adherence` `Score` dimension.
- **Workstream 03** is the skeleton itself (ports + composition root + DI) and the migration path
  off the current Bash globals.
- **Workstream 04** adds `CheckpointStore` and the `ResumeRun` use case + run-state machine.

## 6. Sequencing & milestones

| Milestone | Scope | Exit criteria |
| --- | --- | --- |
| **M0 — Skeleton** | Ports + composition root + domain types (no behavior change) | Unit tests compile/run; `RunBenchmark` use case wired with current codex path behind adapters |
| **M1 — Parity** | Port existing codex + scorers onto the new architecture | A golden run reproduces the current `scores.json`/`report.md` byte-for-byte (modulo timestamps) |
| **M2 — Multi-model + cost** | Workstream [01](01-multi-agent-and-cost.md) | Provider parsers + pricing table green against fixtures; missing-price guard fails the run |
| **M3 — Resumable runs** | Workstream [04](04-resumable-runs.md) | Kill-after-T3 → `--resume` continues at T4; `--only T5` restores prior checkpoint |
| **M4 — Challenge tasks + adherence review** | Workstream [02](02-phase5-capability-tests.md) | New T7+ challenge tasks (HTTP-checked) **and** the log/trace review series; `adherence` score reported |
| **M5 — Harden** | CI workflow, docs, changelog | CI runs unit tests + lints on PRs; `PROTOCOL.md` + `README.md` updated |

Implementation evidence:

| Milestone | Evidence now in branch |
| --- | --- |
| **M0/M1** | `benchmark/orchestrator/**` layers, composition root, architecture-boundary test, and golden `scores.json` / `report.md` parity tests |
| **M2** | Provider usage parsers, `RecordUsage`, pricing guard, `models.local.json` overrides, per-model report rollups |
| **M3** | `state.json`, atomic checkpoint store, workspace snapshots, resume selectors, and CLI resume execution smoke test |
| **M4** | T7-T12 manifest tasks, declarative checks, adherence scoring/collection, pre-Phase-5 reduced-adherence test |
| **M5** | GitHub Actions orchestrator workflow plus updated `README.md`, `benchmark/PROTOCOL.md`, and generated report behavior |

## 7. Cross-cutting acceptance criteria

Each workstream doc owns its detailed, testable acceptance criteria. At the program level:

- **AC-X1** Every new behavior ships with a **fixture-based unit test** (Vitest) and, where it spans
  processes, an **integration test** that runs against a recorded fixture — no network needed in CI.
- **AC-X2** `scores.json` remains backward-compatible: existing keys keep their meaning; new
  dimensions are **additive** (`capability_*`, `evolution_*`, richer `cost`/`usage`).
- **AC-X3** A full run is **reproducible**: same inputs + same pricing table ⇒ identical cost and
  identical scores (timestamps excluded).
- **AC-X4** The migration preserves the existing `benchmark/runs/<id>/…` artifact layout so historical
  runs and `benchmark/compare.sh` / `attribute.sh` keep working.

## 8. Risks & mitigations

| Risk | Mitigation |
| --- | --- |
| Bash→TS rewrite regresses scoring | **M1 parity gate**: keep the Bash runner until a golden run matches; port behind adapters incrementally |
| Per-task workspace snapshots are large or recursive | Snapshot the project dir with an explicit exclusion list (`node_modules`, run checkpoints, logs, WAL/SHM files, transient DBs as appropriate) + copy `harness.db`; or commit-per-task in a scratch git repo |
| Provider JSON formats drift | Parsers are **fixture-driven**; pricing table carries `source_url` + `updated_at`; manual update step is documented and guarded |
| Phase 5 tasks need seeded harness state | Ship **seed fixtures** and self-seeding steps; reuse the checkpoint mechanism from Workstream 04 |
| New tasks could also become "maxable" | Add harder tasks incrementally and keep adherence/evolution checks deterministic: score exact rows, JSON fields, thresholds, and fixture-backed pass/fail cases |

## 9. Decisions recorded by implementation

1. **Orchestrator language** — TypeScript, using the repo's `tsx`/`tsc`/`vitest` toolchain and
   constructor-injected ports.
2. **New task count** — six new challenge tasks, T7-T12, added to the manifest while preserving T1-T6
   as the historical baseline.
3. **Pricing source of truth** — committed defaults in `benchmark/pricing/models.json`, with an
   ignored `benchmark/pricing/models.local.json` override for private experiments.
