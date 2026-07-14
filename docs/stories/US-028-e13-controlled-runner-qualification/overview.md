# US-028 E13 Controlled Runner Qualification — Overview

## Status

implemented

## Current Behavior

The benchmark now owns and consumes two frozen Gate C inputs:

- `US-027` supplies 16 isolated atomic seeds, a separate cumulative journey,
  fixed prompts/rubrics, deterministic reset identities, and offline rubric
  canaries.
- `US-026` supplies the candidate-neutral materializer that stages and applies
  the three checksummed US-106 treatment manifests.

The evaluation-owned path at benchmark commit
`d9e05e395c5c9db8ca5a646e602947156f426b85` now isolates those concerns from
the legacy T1–T12 task/report path. It exercises all three treatments through
fresh fixtures, process-authoritative scoring, frozen rubrics, retained raw
evidence, and independent aggregation. Historical reports remain discovery
evidence and were not rewritten.

## Target Behavior

A new evaluation-owned offline qualification surface adapts the smallest safe
existing runner boundaries. It assembles one frozen treatment into one fresh
atomic fixture, invokes only a deterministic scripted adapter, executes the
frozen rubric, emits complete raw cell evidence, destroys the cell, and
reconstructs aggregates from raw checksums.

Timeout, non-zero exit, illegal atomic dependency, contamination (including a
surviving background descendant), absent or unused rubric, treatment/receipt
mismatch, any other missing/mismatched identity, implicit-zero telemetry,
raw-cell mutation, denominator shrinkage, and aggregate tampering fail closed.
Missing metrics are explicit `unknown` values with reasons.

The qualification receipt records zero live and zero paid agent invocations,
legacy runner/report byte preservation, dependency-audit disposition, cleanup,
and absence of decision-result output. No candidate comparison or ranking is
produced.

## Affected Users

- Benchmark maintainers implementing the Gate C qualification surface.
- Repository Harness maintainers reviewing parent `US-108` evidence.
- Later protocol-lock owners consuming the qualified raw evidence contract.

## Affected Product Docs

- `benchmark/phase0/README.md`
- `benchmark/PROTOCOL.md` as a preserved legacy boundary, not an edit target by
  default
- `docs/stories/US-026-e13-candidate-materializer.md`
- `docs/stories/US-027-e13-neutral-corpus-and-rubrics.md`
- Repository Harness parent `US-108` packet

## Non-Goals

- Invoke Codex or another live/paid agent.
- Run a decision cell, calculate candidate scores, rank treatments, or choose a
  winner.
- Change legacy Bash/TypeScript runner behavior or historical report artifacts.
- Restore Bash parity, change production Repository Harness, or implement a
  production modular manager.
- Freeze decision margins, repetitions, retry/correction rules, or cost ceiling.
- Perform an unbounded rewrite before a focused boundary spike proves it is
  necessary.
