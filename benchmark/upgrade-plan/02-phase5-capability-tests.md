# Workstream 02 — More challenge tasks + harness-adherence review from logs

> Addresses request #2: *"introduce new tests which aim to test most of the repository-harness … phase 5
> with lots of new capabilities. Besides correctness in implementation, think of other aspects and maybe
> suggestion to evolve, propose after finishing the test. Previous benchmark can't do that, and an agent
> without the benchmark can't do that either. Make sure the outcome is clear, acceptance criteria
> testable."*
>
> **Reframed per review:** keep adding **more challenge tasks in the same style as T1–T6** to restore
> difficulty headroom, and add a **new series of checks that review the run's logs/traces/`harness.db`**
> to judge whether the agent actually followed the harness — instead of tasks that instruct the agent to
> run `harness-cli audit`/`propose` directly.

## Problem

1. The functional difficulty has been **mastered**: the latest run scores 37/37 functional and 31/31
   harness (`benchmark/runs/phase-5-evolution-infrastructure-20260608-230505/scores.json`). T1–T6 no
   longer separate a good agent from a great one.
2. There is **no measurement of Phase 5 harness adherence**. The harness records intake, stories,
   decisions, traces, friction, tools, interventions, and a backlog into `harness.db`, and exposes
   `audit`/`score-context`/`propose` — but the benchmark never inspects any of that to ask *"did the
   agent actually work the harness way?"* All automated checks today are HTTP probes
   (`benchmark/lib/check-functional.sh`).

The fix is two complementary parts.

---

## Part A — Keep adding challenge tasks (same kind as T1–T6)

Extend the existing series with **harder feature work** on the Bookmark Manager API, in the exact
task/rubric format already used (`benchmark/tasks/T*.md` = `## Context / ## Task / ## Acceptance
Criteria / ## Notes`; `benchmark/rubrics/T*.md` = `## Functional Checks | ## Harness Compliance |
## Quality Indicators`). Functional checks stay HTTP-testable, exactly like T1–T6.

Illustrative next tasks (final list TBD with you):

| Task | Challenge | Risk lane | Why it's harder |
| --- | --- | --- | --- |
| **T7 — Tags (many-to-many)** | bookmarks↔tags, filter by multiple tags | normal | join modeling + query correctness |
| **T8 — Full-text search** | search title/description/url with ranking | normal | non-trivial query + ordering assertions |
| **T9 — Import / export** | Netscape-HTML or JSON import with idempotent dedupe | normal | parsing + idempotency under re-run |
| **T10 — Folder sharing & permissions** | share folders read-only with other users | **high_risk** | authz boundaries; exercises high-risk lane + decision records |
| **T11 — Concurrency safety** | optimistic locking / conflict handling on update | normal | race conditions, 409 semantics |
| **T12 — Scale & cursor pagination** | cursor pagination + N+1 fix over a large seeded dataset | normal | performance correctness at volume |

These restore headroom on the **functional** dimension. They are deliberately not "maxable" the way
T1–T6 became, and the difficulty curve can keep growing (T13+). Workstream
[03](03-clean-architecture-and-di.md) is what makes "keep adding" cheap, but this workstream must
also define the task registry itself. Today tasks are hardcoded in `benchmark/run.sh` and
`benchmark/lib/check-functional.sh`; adding T7-T12 without fixing that would repeat the current
maintenance problem.

New task registration deliverables:

- `benchmark/tasks/manifest.json` (or `.yaml`) listing task id, prompt path, rubric path, expected
  lane, dependencies, and functional-check file.
- A declarative functional-check schema for HTTP probes: setup requests, request method/path/body,
  expected status, JSON assertions, body assertions, and named variables such as auth tokens.
- A loader test proving that a dummy task can be added by data only: no edits to `run.sh`, use cases,
  or checker control flow.

### Part A acceptance criteria (testable)

| # | Criterion | How to verify |
| --- | --- | --- |
| A1 | Each new task has a `tasks/T*.md` + `rubrics/T*.md` in the existing format | files exist; rubric tables parse |
| A2 | Each functional check is an automated HTTP probe with explicit pass criteria | runs via the existing `run_check`/`run_check_json` style; pass/fail from status + body |
| A3 | Adding a task requires **no orchestrator code change** (data-registered) | add a dummy manifest entry + declarative checks; it runs without touching `run.sh`, use cases, or checker control flow |
| A4 | The high-risk task (T10) drives the `high_risk` lane + a decision record | lane.json `expected == high_risk`; decision row present |
| A5 | Task order and dependencies come from the manifest, not a hardcoded array | manifest loader test returns T1-T12 in dependency-valid order |

---

## Part B — Harness-adherence & evolution review (from logs/traces/db)

A **new check category** the benchmark computes *after* each task by **reviewing evidence the agent left
behind** — `harness.db` rows, the agent's `events.jsonl`/output logs, and the recorded traces. The agent
is **not** told to run any harness command; we measure whether a good harness-using agent naturally did
the right things. This is the "new series of checks from the logs."

Crucially, the **benchmark** runs the Phase 5 review commands as *measurement* (read-only, against the
agent's output), e.g. `harness-cli score-context <trace-id>`, `harness-cli audit`, `harness-cli propose`
— so we score the *outcome/quality* of the agent's work, not whether it was spoon-fed a command.

| Check (review series) | Source reviewed | Phase 5 cmd used for measurement | Responsibility |
| --- | --- | --- | --- |
| **Tool registry hygiene** | `harness.db` tool rows + agent logs | `query tools --json` | Tool access |
| **Verification discipline** | story rows + verify commands | `story verify-all` (review) | Verification |
| **Intervention capture** | intervention rows vs. corrections seen in logs | `query interventions` | Intervention recording |
| **Context compliance** | the agent's recorded trace | `score-context <trace-id>` | Context selection / Observability |
| **Drift / entropy outcome** | resulting repo + docs/state | `audit` → entropy score | Entropy auditing |
| **Evolution signal** | friction/backlog + agent output | `propose` over recorded friction | Failure attribution |

### How each becomes testable

- **Tool registry hygiene**: benchmark queries `query tools --json`; pass requires valid JSON and no
  broken tool rows. If the task used external commands beyond the base toolset, the tool rows must name
  responsibility and install/verify commands.
- **Verification discipline**: benchmark runs `story verify-all`; pass requires exit code 0 or a JSON
  result with zero unverified stories for stories touched during the task.
- **Intervention capture**: benchmark compares log evidence of corrections/retries/errors with
  `query interventions`; pass requires either no correction pattern in logs, or at least one
  intervention row linked to the current trace/story and typed from the allowed taxonomy.
- **Context compliance**: benchmark runs `score-context` on the trace the agent wrote for the task and
  asserts the returned compliance tier ≥ threshold for the task's lane.
- **Drift / entropy outcome**: benchmark runs `audit` on the post-task repo; a good agent leaves **low**
  entropy (e.g. no orphaned docs, stories verified). Score = `entropy_max - entropy_actual`, a deterministic
  integer from the known formula (`repository-harness/PHASE5.md` US-023:
  `orphaned×10 + unverified_stories×5 + unverified_decisions×5 + open_backlog×2 + stale×3 + broken_tools×8`,
  cap 100).
- **Evolution signal**: benchmark runs `propose` over the friction the agent recorded; the check passes
  if there is enough well-formed signal to generate ≥1 structured proposal (problem/evidence/suggested
  change/confidence). This captures *"suggestion to evolve, propose after finishing"* **from evidence the
  agent left**, not from a scripted step. An agent that ignored the harness leaves nothing to propose →
  it scores zero here; an agent **without** the harness can't produce these logs at all.

The first implementation should keep these checks deterministic. "Quality" means exact fields and
thresholds, not human judgment. For example, a proposal is well-formed only if it has non-empty
`problem`, `evidence`, `suggested_change`, and numeric `confidence`, and its `evidence` cites a trace,
story, intervention, or friction row from the current run.

### New metric: harness-adherence score (log-derived)

- **`adherence_pass` / `adherence_total`** — the review-series checks above, rolled into `scores.json`.
- An optional **`evolution_score`** grades the *quality* of the proposable signal (does recorded friction
  cite real ids; is the resulting proposal actionable), so this dimension is not trivially maxable.
- Existing dimensions (functional/harness/trace/lane/cost) are unchanged and remain backward-compatible.

### Part B acceptance criteria (testable)

| # | Criterion | How to verify |
| --- | --- | --- |
| B1 | Every review check is **purely log/db-derived** — no agent instruction to run harness commands | check reads `harness.db` + logs/traces only; task docs contain no "run harness-cli X" steps |
| B2 | Review checks are **machine-evaluated** (jq over `--json`, exit codes, db row counts) | check scripts return pass/fail with no human judgement |
| B3 | Context compliance asserts a **numeric** tier from `score-context` on the agent's trace | unit/integration test on a recorded trace fixture |
| B4 | Entropy outcome is a **numeric** value from `audit` on the post-task repo | integration test compares against a seeded fixture repo |
| B5 | Evolution signal passes only with **well-formed** proposable friction; empty/ignored harness ⇒ fail | run review on a "harness-ignored" fixture ⇒ adherence fails; on a "harness-followed" fixture ⇒ passes |
| B6 | Running the review series against a **pre-Phase-5** harness ref reduces adherence (commands/data absent) | run vs. older `--harness` ref ⇒ adherence_pass < total |
| B7 | `scores.json` gains `adherence_*` (+ optional `evolution_score`); old keys unchanged | schema test |
| B8 | Every adherence check has a pass fixture and fail fixture | fixture suite covers ignored harness, incomplete trace, broken tool, unverified story, high entropy, and well-formed proposal cases |

---

## Touch points

- New challenge tasks: `benchmark/tasks/T7..T12-*.md`, `benchmark/rubrics/T7..T12-*.md` (Part A).
- New task registry: `benchmark/tasks/manifest.json` plus declarative HTTP check files for T1-T12.
- New review layer: `benchmark/lib/check-adherence.sh` (or the TS `HarnessGateway` review probes) that
  reads `harness.db` + `events.jsonl`/logs and shells `score-context`/`audit`/`propose` for measurement;
  optional seed fixtures under `benchmark/seeds/phase5/*`.
- Updates: `benchmark/run.sh` task list, `benchmark/lib/report.sh` roll-up, `benchmark/PROTOCOL.md`.
- Reference (read-only): `repository-harness/PHASE5.md`, `…/docs/HARNESS_COMPONENTS.md`.
