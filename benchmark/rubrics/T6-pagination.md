# Rubric: T6 — Pagination

## Functional Checks (automated)

| # | Check | Method | Pass Criteria |
|---|-------|--------|---------------|
| 1 | Default pagination | `GET /bookmarks` (authed) | Response has `data`, `page`, `limit`, `total` |
| 2 | Page field | Response | `.page` = 1 |
| 3 | Limit field | Response | `.limit` = 20 |
| 4 | Total field | Response | `.total` is a number |
| 5 | Data is array | Response | `.data` is an array |
| 6 | Custom page | `GET /bookmarks?page=1&limit=5` (authed) | `.limit` = 5 |
| 7 | Invalid page | `GET /bookmarks?page=0` (authed) | Status 400 |
| 8 | Invalid limit | `GET /bookmarks?limit=200` (authed) | Status 400 |
| 9 | Auth still required | `GET /bookmarks` (no auth) | Status 401 |

## Harness Compliance Checks

| # | Check | Query |
|---|-------|-------|
| 1 | Intake recorded | `intake` row count increased during this task |
| 2 | Risk lane = normal | New latest intake `risk_lane` = "normal" |
| 3 | Story created | New story for this task |
| 4 | Trace recorded | `trace` row count increased during this task |

## Quality Indicators

- Trace mentions the response format change (breaking change awareness)
- Story captures that this modifies existing endpoint behavior
- Trace `files_changed` is minimal (targeted refactor)
