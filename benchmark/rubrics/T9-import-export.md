# Rubric: T9 — Import / Export

## Functional Checks (automated)

| # | Check | Method | Pass Criteria |
|---|-------|--------|---------------|
| 1 | Export data | `GET /export` | Status 200, bookmarks/folders/tags fields exist |
| 2 | Import valid payload | `POST /import` | Status 200, summary fields exist |
| 3 | Re-import same payload | `POST /import` again | Status 200, duplicates skipped |
| 4 | Invalid payload | `POST /import` malformed shape | Status 400 |
| 5 | Auth required export | `GET /export` without auth | Status 401 |
| 6 | Auth required import | `POST /import` without auth | Status 401 |

## Harness Compliance Checks

| # | Check | Query |
|---|-------|-------|
| 1 | Intake recorded | `intake` row count increased during this task |
| 2 | Risk lane = normal | New latest intake `risk_lane` = "normal" |
| 3 | Story created | New story for this task |
| 4 | Trace recorded | `trace` row count increased during this task |

## Quality Indicators

- Trace mentions idempotent import and URL normalization.
- Story captures user scoping for import/export.
- Validation proves duplicate import behavior.
