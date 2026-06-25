# Workstream 01 — Multi-agent / multi-model runs with accurate usage & cost

> Addresses request #1: *"run the benchmark with different coding agents and models … be aware of
> different endpoints format … know the exact usage of each call, interaction, and cost … each model
> has its own cost … maybe before running the benchmark, there should be a manual update in the cost."*

## Problem

- `benchmark/lib/invoke.sh` only parses **codex** output. `invoke_claude` (`:104-127`) and
  `invoke_custom` (`:129-150`) hardcode `{"input_tokens":0,…,"estimated_cost_usd":0}` — so any
  non-codex run reports **zero usage and zero cost**.
- Cost is a **single hardcoded rate** applied to every model (`invoke.sh:174-176`):
  ```bash
  # Cost estimate: ~$3/M input, ~$12/M output (o4-mini approximate)
  cost=$(echo "scale=4; ($input_tokens * 0.000003) + ($output_tokens * 0.000012)" | bc ...)
  ```
  Running `--model gpt-4.1` or a Claude model silently bills at o4-mini rates.
- Usage is only ever a **per-task total**. There is no per-call / per-interaction breakdown, so we
  cannot see that (e.g.) T4 made 9 turns, or attribute cost to cached vs. fresh input.

## Proposed design

### A. Normalize usage behind a `UsageParser` port

One parser per provider **wire format**, not per agent CLI. Each returns a normalized record:

```ts
interface Interaction {            // one API round-trip / turn
  model: string;                   // resolved model id for THIS call
  inputTokens: number;
  cachedInputTokens: number;       // billed at the cached rate
  outputTokens: number;            // total billed output tokens, including reasoning when provider reports it that way
  reasoningTokens?: number;        // informational breakdown only unless the provider prices it separately
}
interface NormalizedUsage {
  provider: 'openai' | 'anthropic' | 'custom';
  interactions: Interaction[];
  totals: { input; cachedInput; output; reasoning; total };
}
interface UsageParser { parse(raw: RawAgentOutput): NormalizedUsage; }
```

Concrete parsers:

- **`OpenAiUsageParser`** — handles both:
  - codex `--json` event stream (current path): sum `turn.completed` events, reading
    `usage.input_tokens`, `usage.cached_input_tokens`, `usage.output_tokens`,
    `usage.reasoning_output_tokens` — **one `Interaction` per turn** (today `invoke.sh:169-171`
    collapses these into one total).
  - raw Chat/Responses `usage`: `prompt_tokens`, `completion_tokens`,
    `prompt_tokens_details.cached_tokens`, `completion_tokens_details.reasoning_tokens`.
- **`AnthropicUsageParser`** — claude-code `--output-format json` `result.usage`, and the Messages API
  `usage`: `input_tokens`, `output_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens`
  (cache-read maps to `cachedInputTokens`).
- **`CustomUsageParser`** — best-effort: read a `usage.json` the custom agent may emit; otherwise mark
  usage `unknown` (not silently `0`) so cost is reported as `null`, not a false `$0`.

The `AgentAdapter` (Workstream 03) is responsible only for **spawning** the agent and capturing raw
output; it delegates accounting to the matching `UsageParser`. This is what lets us "get the best out
of the json response" for each endpoint format.

### B. Manually-updatable pricing table → `CostModel`

A committed, human-edited table is the source of truth for "each model has its own cost":

```jsonc
// benchmark/pricing/models.json   (USD per 1M tokens)
{
  "version": "2026-06-13",
  "models": {
    "gpt-5-codex":          { "provider": "openai",    "input": 1.25, "cachedInput": 0.125, "output": 10.00, "source": "https://openai.com/api/pricing/",  "updatedAt": "2026-06-13" },
    "o4-mini":              { "provider": "openai",    "input": 3.00, "cachedInput": 0.75,  "output": 12.00, "source": "https://openai.com/api/pricing/",  "updatedAt": "2026-06-13" },
    "claude-sonnet-4":      { "provider": "anthropic", "input": 3.00, "cachedInput": 0.30,  "output": 15.00, "source": "https://www.anthropic.com/pricing", "updatedAt": "2026-06-13" }
  }
}
```

> Values above are **placeholders to illustrate the schema** — the first implementation task is to
> fill them from each provider's pricing page and record `source`/`updatedAt`.

`CostModel` (pure domain) computes cost per interaction using *that interaction's* model, then sums.
The normalization contract is important: `outputTokens` means the provider's billed output total.
For OpenAI-style usage, reasoning tokens are usually a breakdown inside output tokens, so they must
not be added a second time. `reasoningTokens` is billed only when a pricing table explicitly declares
that the provider reports/prices reasoning outside `outputTokens`.

```
cost(interaction) = input/1e6 * rate.input
                  + cachedInput/1e6 * rate.cachedInput
                  + output/1e6 * rate.output
                  + reasoningOutsideOutput/1e6 * rate.reasoning
```

Parser fixtures must assert the invariant:

```
totalTokens == inputTokens + outputTokens
reasoningTokens <= outputTokens   // for providers that include reasoning in output
```

If a provider reports reasoning outside output, the parser must set an explicit
`reasoningTokensBilledSeparately: true` flag so the cost model can charge it without guessing.

### C. "Manual update before running" — make it a guarded step

- `PricingProvider` loads `models.json` (plus an optional uncommitted `models.local.json` override).
- A new `harness-bench pricing validate` subcommand prints the effective table and verifies it parses.
- **Guard**: before a run starts, the resolved model(s) must exist in the table. If a model is
  missing, the run **fails fast** with an actionable message (`--allow-missing-pricing` downgrades to
  a warning and records `cost: null`). This guarantees we never silently misreport cost again.

### D. Output schema

Add `benchmark/runs/<id>/<task>/usage.json` (supersedes the thin `tokens.json`, which is kept as a
compatibility view):

```jsonc
{
  "provider": "openai",
  "model": "gpt-5-codex",
  "interactions": [ { "model": "gpt-5-codex", "inputTokens": 41233, "cachedInputTokens": 39000,
                      "outputTokens": 1875, "reasoningTokens": 512, "costUsd": 0.0712 }, ... ],
  "totals": { "inputTokens": ..., "outputTokens": ..., "totalTokens": ..., "costUsd": 0.83 },
  "pricingVersion": "2026-06-13"
}
```

`report.sh`/`GenerateReport` rolls these up into `scores.json` with **per-model subtotals** and a
`pricingVersion`, and asserts `sum(interaction.costUsd) == totals.costUsd`.

## Acceptance criteria (testable)

| # | Criterion | How to verify |
| --- | --- | --- |
| 1 | OpenAI parser sums a recorded codex `events.jsonl` fixture to a known total and **N interactions** | Unit test asserts `interactions.length` and `totals` against a golden fixture |
| 2 | Anthropic parser maps `cache_read_input_tokens` → `cachedInputTokens` from a `result.json` fixture | Unit test against an Anthropic fixture |
| 3 | `--agent claude` produces **non-zero** usage from a fixture (regression vs. today's hardcoded `0`) | Integration test: run claude adapter on fixture, assert `totals.total > 0` |
| 4 | Cost for a fixture equals an exact expected dollar value under a **pinned** pricing table, without double-counting reasoning tokens | Unit test with deterministic fixture + frozen `models.json`; fixture includes reasoning token breakdown |
| 5 | Per-interaction costs **sum to** the reported task/run total | Property test over generated usage records |
| 6 | A model absent from the pricing table makes the run **exit non-zero** naming the model | Integration test: run with `--model nope`, assert exit≠0 + message; `--allow-missing-pricing` ⇒ exit 0, `cost: null` |
| 7 | `harness-bench pricing validate` prints the effective table and fails on malformed JSON | CLI test on a good and a corrupt `models.json` |
| 8 | Cached input is billed at the **cached** rate, not the input rate | Unit test: fixture with cached tokens yields lower cost than if billed at full input rate |
| 9 | Unknown usage is represented as `usageKnown:false` and `costUsd:null`, never false zeroes | Custom-agent fixture without `usage.json`; report preserves null cost |

## Touch points

- New: `benchmark/pricing/models.json`, `…/ports/UsageParser`, `…/infrastructure/{OpenAi,Anthropic,Custom}UsageParser`, `…/domain/CostModel`, `…/infrastructure/JsonPricingProvider`.
- Replaces logic in: `benchmark/lib/invoke.sh:104-150,167-176`.
- Updates: `benchmark/lib/report.sh:87-` (roll-up), `benchmark/PROTOCOL.md` (cost section).
