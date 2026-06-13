# Workstream 02 — Phase 5 capability tests & the evolution challenge

> Addresses request #2: *"introduce new tests which aim to test most of the repository-harness … phase 5
> with lots of new capabilities. Beside correctness in implementation, think of other aspects and maybe
> suggestion to evolve, propose after finishing the test. Previous benchmark can't do that, and an agent
> without the benchmark can't do that either. Make sure the outcome is clear, acceptance criteria
> testable."*

## Problem

Today every automated check is an HTTP probe against the Bookmark Manager API the agent builds
(`benchmark/lib/check-functional.sh`). The harness checks (`check-harness.sh`) only count
intake/story/decision/trace rows and the lane. **No task uses any Phase 5 capability**, and there is
no metric for the agent's ability to **evolve the project** (audit drift, propose improvements).

That is the precise capability the user calls out: an agent *with* the Phase 5 harness can audit and
propose; an agent *without* it cannot; and the *old* benchmark could not measure it.

## Design overview

Add a **Phase 5 capability suite** — tasks **T7–T12** — that runs after the functional baseline
(T1–T6). Each task:

- has a **clear deliverable** and a **machine-checkable** rubric (jq over `--json` output, `harness-cli`
  exit codes, row counts in `harness.db`);
- maps to one or more of the **11 Runtime Substrate responsibilities** (see
  `repository-harness/docs/HARNESS_COMPONENTS.md`), prioritizing the three Phase 5 *added* (Tool access,
  Entropy auditing, Intervention recording) and the three *partial* (Observability, Failure
  attribution, Permissions);
- emits a new `capability.json` (and, for the capstone, `evolution.json`).

The new tasks follow the existing doc format: `benchmark/tasks/T*.md`
(`## Context / ## Task / ## Acceptance Criteria / ## Notes`) and `benchmark/rubrics/T*.md`
(`## Functional Checks` | `## Harness Compliance` | `## Quality Indicators`).

## Proposed tasks

| Task | Capability under test | Phase 5 cmd(s) | Responsibility |
| --- | --- | --- | --- |
| **T7 — Tool registry & discovery** | Register a project tool, discover it, remove it | `tool register`, `query tools --json`, `tool remove` | Tool access |
| **T8 — Verification gate** | Add stories with verify commands; batch-verify | `story verify-all` | Verification |
| **T9 — Intervention recording** | Record interventions; query by trace/type | `intervention add`, `query interventions` | Intervention recording |
| **T10 — Context discipline** | Produce a trace, score its context compliance, act on advisories | `score-context <trace-id>` | Context selection / Observability |
| **T11 — Drift audit** | Introduce drift, then reduce the entropy score | `audit` | Entropy auditing |
| **T12 — Evolution proposal (capstone)** | Turn seeded friction into a structured improvement proposal + a written evolution suggestion | `propose [--commit]` | Failure attribution / Entropy auditing |

### Example — T11 (Drift audit), testable end to end

- **Context**: the seeded repo has an orphaned doc and an unverified story (drift).
- **Task**: run `harness-cli audit`; resolve enough findings to bring the **entropy score** down by a
  target margin; record a trace explaining what was fixed.
- **Acceptance criteria** (each a command with a pass condition):

| # | Check | Method | Pass criteria |
| --- | --- | --- | --- |
| 1 | Baseline drift exists | `harness-cli audit` (pre) | entropy score ≥ seeded threshold |
| 2 | Agent reduced drift | `harness-cli audit` (post) | entropy score ≤ target (e.g. ≥ 30-point drop) |
| 3 | No new orphaned docs introduced | parse `audit` categories | `orphaned == 0` in changed set |
| 4 | Fix is traced | `query` latest trace | trace references `audit` + the resolved findings |

The entropy formula is fixed and known (`repository-harness/PHASE5.md`, US-023:
`orphaned×10 + unverified_stories×5 + unverified_decisions×5 + open_backlog×2 + stale×3 + broken_tools×8`,
capped at 100), so "reduced by ≥ N" is deterministic and testable.

### Example — T12 (Evolution capstone), the "propose to evolve" test

- **Context**: the run has accumulated real friction (from T1–T11) plus seeded interventions.
- **Task**: run `harness-cli propose` to generate improvement proposals from that friction; select the
  best, `propose --commit` it into the backlog; then **write a short `EVOLUTION.md`** arguing what the
  *project or the harness itself* should change next and why.
- **Acceptance criteria**:

| # | Check | Method | Pass criteria |
| --- | --- | --- | --- |
| 1 | At least one proposal generated | `harness-cli propose` | ≥ 1 proposal, each with all required fields (problem, evidence, suggested change, confidence ∈ {High,Med,Low}) |
| 2 | Proposal committed to backlog | `harness-cli backlog list` / `query` | committed item present with `source = propose` |
| 3 | Evolution deliverable exists & is grounded | check `EVOLUTION.md` | references ≥ 1 concrete friction/intervention id and a specific harness responsibility |
| 4 | Proposal is non-trivial | rubric scorer | evolution score ≥ threshold (see scoring) |

This is the explicit "an agent **without** the benchmark can't do this" test: without the Phase 5
harness there is no `propose`/`audit`/backlog to drive it, and without the benchmark nobody grades the
quality of the resulting evolution.

## New metrics (additive to `scores.json`)

- **`capability_pass` / `capability_total`** — automated Phase 5 checks across T7–T12.
- **`evolution_score`** (0–N) — grades T12 proposal quality, scored on a rubric (problem clearly
  stated; evidence cites real ids; suggested change is actionable; confidence justified; the written
  suggestion targets a real responsibility/gap). Presence alone is **not** enough — this prevents the
  new task from becoming trivially maxable like the current ones.
- Existing dimensions (functional/harness/trace/lane/cost) are unchanged.

## Acceptance criteria (workstream-level, testable)

| # | Criterion | How to verify |
| --- | --- | --- |
| 1 | Each of T7–T12 has a task doc + rubric in the existing format | files exist; rubric tables parse |
| 2 | Each capability check is **machine-evaluated** (no human judgement) | check scripts return pass/fail purely from `--json`/exit codes/db rows |
| 3 | Capability checks **fail** when run against a pre-Phase-5 harness ref | run T7–T12 against an older `--harness` ref ⇒ capability_pass < total |
| 4 | `audit`-based tasks assert a **numeric** entropy delta, not presence | T11 check compares pre/post entropy integers |
| 5 | Evolution score is reproducible for a fixed proposal fixture | unit test scores a recorded `propose` output to a known value |
| 6 | New tasks integrate with resume/checkpoint (Workstream 04) | `--only T11` restores prior checkpoint and runs just T11 |
| 7 | `scores.json` gains `capability_*` and `evolution_score`; old keys unchanged | schema test |

## Touch points

- New: `benchmark/tasks/T7..T12-*.md`, `benchmark/rubrics/T7..T12-*.md`,
  `benchmark/lib/check-capability.sh` (or the TS `HarnessGateway` probes), `benchmark/seeds/phase5/*`
  (seed fixtures for drift/friction/interventions).
- Updates: `benchmark/run.sh` task list, `benchmark/lib/report.sh` roll-up, `benchmark/PROTOCOL.md`.
- Reference (read-only): `repository-harness/PHASE5.md`, `…/docs/HARNESS_COMPONENTS.md`.
