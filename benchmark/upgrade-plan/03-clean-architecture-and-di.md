# Workstream 03 — Pragmatic clean architecture & dependency injection

> Addresses request #3: *"Consider our benchmark structure, make it more pragmatic, clean architecture,
> dependency injection, think of macro architecture."*

## Problem

The orchestrator is a set of **sourced Bash scripts that communicate through global variables**:

- `benchmark/run.sh` sets globals `AGENT`, `AGENT_CMD`, `HARNESS_REF`, `RUN_ID`, `MODEL`,
  `TASK_TIMEOUT`, `ISOLATE`, then `source`s `lib/prepare.sh`, `lib/invoke.sh`, `lib/check-*.sh`,
  `lib/report.sh`. Each lib reads/writes those globals and writes JSON files as a side effect.
- There are **no seams**: you cannot unit-test cost math without spawning an agent; you cannot add a
  provider without editing `invoke.sh`; control flow and I/O are fused.

This is why Workstreams 01/02/04 are hard today — every one of them would mean more branches inside
already-large Bash functions.

## Decision: TypeScript orchestrator (reuse the repo's existing toolchain)

The repo already ships a Node/TS toolchain — `package.json` has `tsx`, `typescript`, and **`vitest`**
(currently used only for the system-under-test seed in `src/`). Reusing it for the orchestrator gives:

- real **constructor dependency injection** and interfaces (ports), which Bash cannot express cleanly;
- **unit-testable** domain logic (cost, scoring, entropy deltas, checkpoint state machine) with Vitest;
- a single language for orchestrator + the fixtures it tests.

The alternative — a disciplined Bash refactor (explicit params, no globals, adapter files resolved by
convention) — is cheaper but still can't give true DI or ergonomic unit tests. **Recommendation:
TypeScript**, with a parity gate (M1) so we never regress scoring. *This is the one decision to confirm
before M0 — see [README §9](README.md#9-open-questions-for-review).*

The existing Bash checks are not thrown away: `HttpFunctionalProbe` and `SqliteHarnessGateway` may
shell out to the current curl/sqlite logic during migration, then be ported incrementally.

## Macro architecture

```
benchmark/orchestrator/
  domain/            # pure, no I/O, no deps on outer layers
    task.ts            RunPlan, Task, TaskResult
    score.ts           Score, ScoreDimension (functional, harness, trace, lane, capability, evolution)
    usage.ts           Interaction, NormalizedUsage
    cost.ts            CostModel (pure pricing math)
    checkpoint.ts      CheckpointState, StepStatus state machine
  ports/             # interfaces only (the dependency-inversion boundary)
    AgentAdapter.ts    invoke(task, ctx): RawAgentOutput
    UsageParser.ts     parse(raw): NormalizedUsage
    PricingProvider.ts rateFor(model): ModelRate | undefined
    HarnessGateway.ts  audit(), proposals(), queryTools(), verifyAll(), counts()...
    FunctionalProbe.ts run(task, baseUrl): CheckResult[]
    CheckpointStore.ts load/save/restore(runId, task)
    FileStore.ts, Clock.ts
  application/       # use cases; depend ONLY on ports + domain
    RunBenchmark.ts
    ResumeRun.ts
    ScoreTask.ts
    GenerateReport.ts
    CompareRuns.ts
  infrastructure/    # port implementations; the only layer touching the OS
    CodexAdapter.ts  ClaudeAdapter.ts  CustomAdapter.ts
    OpenAiUsageParser.ts  AnthropicUsageParser.ts  CustomUsageParser.ts
    JsonPricingProvider.ts
    SqliteHarnessGateway.ts  HttpFunctionalProbe.ts
    FsCheckpointStore.ts  FsFileStore.ts  SystemClock.ts
  interface/
    cli.ts             # arg parsing (--agent/--model/--resume/--only/...)
    composition-root.ts# THE wiring: build infra, inject into use cases (the DI container)
```

**Dependency rule**: arrows point inward. `domain` depends on nothing; `application` depends on
`ports` + `domain`; `infrastructure` implements `ports`; `interface` is the only place that knows
concrete classes and wires them.

### Dependency injection (composition root)

A single composition root resolves adapters by name — adding a provider is a registry entry, not a
new `if` branch in a 200-line function:

```ts
// interface/composition-root.ts
export function buildRunner(cfg: CliConfig) {
  const pricing = new JsonPricingProvider(cfg.pricingPath);
  const agents: Record<string, () => AgentAdapter> = {
    codex:  () => new CodexAdapter(new OpenAiUsageParser(), pricing),
    claude: () => new ClaudeAdapter(new AnthropicUsageParser(), pricing),
    custom: () => new CustomAdapter(cfg.agentCmd, new CustomUsageParser(), pricing),
  };
  const agent = (agents[cfg.agent] ?? fail(`unknown agent ${cfg.agent}`))();
  return new RunBenchmark({
    agent,
    harness:    new SqliteHarnessGateway(cfg.dbPath),
    functional: new HttpFunctionalProbe(cfg.baseUrl),
    checkpoints:new FsCheckpointStore(cfg.runDir),
    report:     new GenerateReport(),
    clock:      new SystemClock(),
  });
}
```

Use cases receive their dependencies by constructor — in tests we inject **fakes** (in-memory
`CheckpointStore`, a fixture-backed `AgentAdapter`, a frozen `Clock`) and assert behavior without any
process, network, or sqlite.

## Migration path (no big-bang rewrite)

| Step | Action | Safety |
| --- | --- | --- |
| M0 | Add `orchestrator/` skeleton (ports + domain + composition root); wire codex path through `CodexAdapter` that *shells out to existing scripts* | Old `run.sh` still the default entrypoint |
| M1 | Port scorers + report into `application`; add golden-run parity test | **Gate**: new run reproduces current `scores.json`/`report.md` (timestamps excluded) before switching the default |
| later | Replace shell-outs with native TS implementations incrementally | Each port has its own fixture tests |

## Acceptance criteria (testable)

| # | Criterion | How to verify |
| --- | --- | --- |
| 1 | `domain` + `application` have **zero imports** from `infrastructure` | lint rule / dependency-cruiser test fails on violation |
| 2 | Cost, scoring, and entropy-delta logic are unit-tested **without** spawning a process | Vitest suites use fakes only |
| 3 | Adding a new agent = one registry entry + one adapter, **no edits** to use cases | code review + a test that registers a dummy adapter |
| 4 | A run via the new composition root **matches** the legacy run output (parity) | golden-file test on `scores.json` (M1 gate) |
| 5 | Use cases depend only on **ports**, injected via constructor | type-level + review; fakes substitute in tests |
| 6 | Existing `benchmark/runs/<id>/…` artifact layout is preserved | parity test asserts file paths |

## Touch points

- New: `benchmark/orchestrator/**`, Vitest config wired for it, a dependency-direction lint check.
- Wraps/replaces: `benchmark/run.sh`, `benchmark/lib/*.sh` (kept during migration, retired after M1).
- Reference (read-only): `repository-harness/crates/harness-cli/src/{domain,application,infrastructure,interface}.rs` — the same layered shape we mirror (its ports are traits inside `domain.rs`/`application.rs`).
