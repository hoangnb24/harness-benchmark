# Benchmark Upgrade Plan

> Status: **Proposal** (no behavior changed by this PR — this directory is the plan only).
> Target: `harness-benchmark` orchestrator + task suite.
> Motivation: `repository-harness` has reached **Phase 5 (Evolution Infrastructure)**, but this
> benchmark has not kept pace. Recent runs **max out** the metrics it measures, so it can no
> longer tell us whether the harness is actually getting better.

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
whether the agent can use the harness to **audit drift and propose its own evolution** — which is
the entire point of Phase 5 and exactly what *"a previous benchmark can't do, and an agent without
the benchmark can't do either."*

## 2. Goals

1. **Multi-agent / multi-model** runs with **provider-accurate usage and cost** accounting
   (OpenAI/codex, Anthropic/claude, custom), driven by a **manually-updatable pricing table**.
2. **New, harder tasks** that exercise the breadth of Phase 5 `repository-harness` capabilities and
   measure **evolution** (the agent must audit + propose), not just implementation correctness —
   with **clear, machine-testable acceptance criteria**.
3. A **pragmatic clean architecture** for the orchestrator: explicit layers, **dependency injection**,
   and clear macro boundaries (replacing the current sourced-Bash + global-variable design).
4. **Resumable / retryable runs**: continue from the last failed step, or re-run a chosen step,
   instead of restarting the whole ~25-minute / ~$19 run after an out-of-credits or network blip.

## 3. Non-goals (for this plan PR)

- This PR **does not implement** any of the four workstreams. It only proposes the design and the
  acceptance criteria. Each workstream below is sized to land as its own follow-up PR.
- We do not change the system-under-test (the Bookmark Manager API spec in `PRODUCT_SPEC.md`) except
  to *add* new task tiers; the existing T1–T6 remain the functional-correctness baseline.
- We do not change `repository-harness`.

## 4. Current-state assessment (what backs each workstream)

| Area | Today | Evidence | Workstream |
| --- | --- | --- | --- |
| Agents | `codex` fully parsed; `claude` & `custom` write **zero** tokens | `benchmark/lib/invoke.sh:104-150` | [01](01-multi-agent-and-cost.md) |
| Cost | single hardcoded rate `$3/M in, $12/M out` for **all** models | `benchmark/lib/invoke.sh:174-176` | [01](01-multi-agent-and-cost.md) |
| Phase 5 caps | not tested; checks are 100% HTTP probes | `benchmark/lib/check-functional.sh` | [02](02-phase5-capability-tests.md) |
| Evolution | no task requires `audit`/`propose`; no evolution metric | `benchmark/lib/report.sh:87-` scores.json | [02](02-phase5-capability-tests.md) |
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
- **Workstream 02** adds Phase 5 capability probes behind `HarnessGateway` plus new domain
  `Score` dimensions (capability, evolution) and new task specs/rubrics.
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
| **M4 — Phase 5 tasks** | Workstream [02](02-phase5-capability-tests.md) | New T7–T12 with automated checks; capability + evolution scores reported |
| **M5 — Harden** | CI workflow, docs, changelog | CI runs unit tests + lints on PRs; `PROTOCOL.md` + `README.md` updated |

M0/M1 are foundational and must land before 01/02/04 to avoid building three features on top of
the current global-variable runner. 03 is therefore sequenced first even though the user listed it third.

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
| Per-task workspace snapshots are large | Snapshot the project dir **excluding `node_modules`** + copy `harness.db`; or commit-per-task in a scratch git repo |
| Provider JSON formats drift | Parsers are **fixture-driven**; pricing table carries `source_url` + `updated_at`; manual update step is documented and guarded |
| Phase 5 tasks need seeded harness state | Ship **seed fixtures** and self-seeding steps; reuse the checkpoint mechanism from Workstream 04 |
| New tasks could also become "maxable" | Evolution score grades **proposal quality**, not just presence; rubric thresholds tuned against a baseline run |

## 9. Open questions for review

1. **Orchestrator language** — TypeScript (reuses the repo's existing `tsx`/`tsc`/`vitest` toolchain
   and gives real constructor DI) vs. a disciplined Bash refactor. This plan recommends **TypeScript**;
   see [03](03-clean-architecture-and-di.md) §Decision. Confirm before M0.
2. **New task count** — propose six (T7–T12). Is that the right breadth, or should evolution be a
   single capstone (T12) with the rest folded into existing tasks?
3. **Pricing source of truth** — a single `benchmark/pricing/models.json` committed to the repo, vs.
   an uncommitted local override file. Plan proposes committed defaults + optional local override.
