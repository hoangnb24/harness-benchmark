# Stories

Stories are work packets. They turn product intent into bounded implementation
and validation work.

Phase 0 benchmark implementation:

- [`US-026` E13 Candidate Materializer](US-026-e13-candidate-materializer.md)
- [`US-027` E13 Neutral Corpus And Rubrics](US-027-e13-neutral-corpus-and-rubrics.md)
- [`US-028` E13 Controlled Runner Qualification](US-028-e13-controlled-runner-qualification/overview.md)
- [`US-029` E13 Decision Runner Prelock](US-029-e13-decision-runner-prelock.md)
- [`US-030` E13 Held-Out Calibration Packet](US-030-e13-held-out-calibration-packet/overview.md)

## Normal Story

Use `docs/templates/story.md` for normal feature work.

Suggested path:

```text
docs/stories/epics/E01-domain-name/US-001-short-story-title.md
```

## High-Risk Story

Use `docs/templates/high-risk-story/` when the feature intake classifies work as
high-risk.

Suggested path:

```text
docs/stories/epics/E02-risky-domain/US-012-risky-story-title/
  execplan.md
  overview.md
  design.md
  validation.md
```

## Status Flow

```text
planned -> in_progress -> implemented
                  |
                  v
               changed
                  |
                  v
               retired
```
