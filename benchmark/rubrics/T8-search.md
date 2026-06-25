# Rubric: T8 — Full-Text Search

## Functional Checks (automated)

| # | Check | Method | Pass Criteria |
|---|-------|--------|---------------|
| 1 | Seed searchable bookmarks | `POST /bookmarks` | Status 201 |
| 2 | Search title | `GET /bookmarks?q=docs` | Status 200, data array |
| 3 | Search no match | `GET /bookmarks?q=no-such-token` | Status 200, empty data |
| 4 | Search with tag | `GET /bookmarks?q=docs&tag=work` | Status 200 |
| 5 | Long query rejected | `GET /bookmarks?q=<201 chars>` | Status 400 |
| 6 | Auth still required | `GET /bookmarks?q=docs` without auth | Status 401 |

## Harness Compliance Checks

| # | Check | Query |
|---|-------|-------|
| 1 | Intake recorded | `intake` row count increased during this task |
| 2 | Risk lane = normal | New latest intake `risk_lane` = "normal" |
| 3 | Story created | New story for this task |
| 4 | Trace recorded | `trace` row count increased during this task |

## Quality Indicators

- Trace mentions ranking and auth scoping.
- Story captures search fields and query limits.
- Validation proves search combines with pagination/tag filters.
