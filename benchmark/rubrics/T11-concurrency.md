# Rubric: T11 — Concurrency Safety

## Functional Checks (automated)

| # | Check | Method | Pass Criteria |
|---|-------|--------|---------------|
| 1 | Create versioned bookmark | `POST /bookmarks` | Status 201, `version` = 1 |
| 2 | Current version update | `PUT /bookmarks/:id` with `version` | Status 200, `version` increments |
| 3 | Stale version update | `PUT /bookmarks/:id` with old `version` | Status 409 |
| 4 | Conflict body | Stale response | Includes current bookmark |
| 5 | Missing version | `PUT /bookmarks/:id` without version | Status 400 |

## Harness Compliance Checks

| # | Check | Query |
|---|-------|-------|
| 1 | Intake recorded | `intake` row count increased during this task |
| 2 | Risk lane = normal | New latest intake `risk_lane` = "normal" |
| 3 | Story created | New story for this task |
| 4 | Trace recorded | `trace` row count increased during this task |

## Quality Indicators

- Trace mentions optimistic locking.
- Story captures existing PUT contract change.
- Validation proves stale writes cannot overwrite current data.
