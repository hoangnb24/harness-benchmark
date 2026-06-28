# Rubric: T12 — Scale and Cursor Pagination

## Functional Checks (automated)

| # | Check | Method | Pass Criteria |
|---|-------|--------|---------------|
| 1 | Cursor first page | `GET /bookmarks?limit=2` cursor mode | Response has `data`, `limit`, `nextCursor`, `hasMore` |
| 2 | Cursor second page | `GET /bookmarks?cursor=<nextCursor>` | Status 200, no duplicate first item |
| 3 | Invalid cursor | `GET /bookmarks?cursor=bad` | Status 400 |
| 4 | Offset compatibility | `GET /bookmarks?page=1&limit=2` | Existing envelope still works |
| 5 | Auth still required | `GET /bookmarks?cursor=...` without auth | Status 401 |

## Harness Compliance Checks

| # | Check | Query |
|---|-------|-------|
| 1 | Intake recorded | `intake` row count increased during this task |
| 2 | Risk lane = normal | New latest intake `risk_lane` = "normal" |
| 3 | Story created | New story for this task |
| 4 | Trace recorded | `trace` row count increased during this task |

## Quality Indicators

- Trace mentions stable ordering by created time and id.
- Story captures backward compatibility with offset pagination.
- Validation includes invalid cursor and duplicate avoidance.
