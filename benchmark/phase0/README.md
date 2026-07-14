# E13 Phase 0 Neutral Corpus

This directory is the benchmark-owned `US-105` corpus. It is separate from the
historical T1–T12 sequence and does not use the solved mutable `main` workspace
as any task start.

The corpus contains:

- `atomic-catalog.json`: 16 independently seeded atomic tasks, at least two per
  atomic activation profile;
- `cumulative-catalog.json`: one visibly separate dependency journey that is
  excluded from atomic class scores;
- `canaries.json`: offline positive and negative scorer inputs;
- `corpus-lock.json`: frozen fixture, prompt, and rubric identities;
- `materialize-fixture.mjs`: deterministic fixture materializer and reset
  receipt writer;
- `rubric-runner.mjs`: candidate-neutral, fixed-denominator, fail-closed rubric
  executor; and
- `verify-corpus.mjs`: structure, identity, reset, positive, and negative
  canary proof. It never invokes an agent.

## Atomic Classes

| Class | E13 mapping | Tasks |
| --- | --- | ---: |
| `read-only-diagnosis` | Read-only diagnosis | 2 |
| `tiny-documentation` | Semantically tiny documentation change | 2 |
| `bounded-defect-repair` | Bounded defect repair | 2 |
| `normal-behavior-change` | Normal behavior change | 2 |
| `high-risk-identity-data` | Two identity plus two data/release fixtures | 4 |
| `brownfield-ownership` | Brownfield ownership change | 2 |
| `runtime-observability` | Runtime and observability task | 2 |

US-106 defines seven atomic activation profiles and the eighth profile,
`cumulative-coordination`. The high-risk profile deliberately has four fixtures
so identity/authorization and data/release behavior each receive two seeds.
The separate cumulative journey is non-atomic and does not make a class-level
claim.

## Isolation Contract

Each atomic task has its own inline seed with a unique `seedId`, no dependency,
and no reference to another task workspace. `materialize-fixture.mjs` verifies
the seed against `corpus-lock.json`, refuses a non-empty destination, writes
only the declared seed files, and emits an external start receipt containing
the fixture identity, deterministic one-commit Git start, and individual file
hashes. Every start commit has fixed author, timestamp, and message metadata and
has no parent.

Reset proof materializes every seed twice into new temporary directories and
requires both tree identities to equal the frozen fixture identity. No output
from one task is reused by another.

The cumulative journey has its own seed, prompts, rubrics, and identities. Its
manifest sets `excludedFromAtomicScores` to `true`; its steps may depend on one
another, but its state can never become an atomic starting fixture.

## Rubric Contract

Rubrics inspect only observable workspace or submission outcomes. They never
require a Harness database, story, trace, module, receipt shape, or candidate
name. Each rubric declares a fixed denominator and explicit critical checks.

Bounded-defect, normal-behavior, and high-risk tasks execute frozen seeded
probes instead of trusting source substrings. Each command check has a timeout
and records argv, exit status, and SHA-256 identities for stdout and stderr in
the scoring receipt. Runtime tasks in this corpus produce runbooks, so their
observable behavior is the runbook content and preservation of its declared
command sources; they do not invent a second service implementation.

The executor fails closed when:

- a task or rubric is missing;
- lock, prompt, fixture, rubric, or receipt identity differs;
- the rubric denominator differs from its declared checks;
- a critical safety check fails; or
- any check cannot be evaluated.

The false-positive canary places the expected authorization expression only in
a comment while leaving cross-tenant behavior wrong. Static text is present,
but the seeded executable probe fails critically.

Run all offline proof with:

```bash
node benchmark/phase0/verify-corpus.mjs
```

Materialize one fixture without invoking an agent:

```bash
node benchmark/phase0/materialize-fixture.mjs \
  --task P0-A01-diagnose-timeout \
  --output /tmp/p0-a01 \
  --receipt /tmp/p0-a01-start.json
```

Score a prepared workspace/submission:

```bash
node benchmark/phase0/rubric-runner.mjs \
  --task P0-A01-diagnose-timeout \
  --workspace /tmp/p0-a01 \
  --submission /tmp/p0-a01-submission \
  --receipt /tmp/p0-a01-start.json
```

These commands are corpus proof only. Live/paid execution remains forbidden
until the later E13 gates authorize it.
