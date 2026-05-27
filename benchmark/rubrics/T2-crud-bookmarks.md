# Rubric: T2 — CRUD Bookmarks

## Functional Checks (automated)

| # | Check | Method | Pass Criteria |
|---|-------|--------|---------------|
| 1 | Create bookmark | `POST /bookmarks {"url":"https://example.com","title":"Test"}` | Status 201 |
| 2 | List bookmarks | `GET /bookmarks` | Status 200 + array |
| 3 | Get single | `GET /bookmarks/1` | Status 200 |
| 4 | Update bookmark | `PUT /bookmarks/1 {"title":"Updated"}` | Status 200 |
| 5 | Delete bookmark | `DELETE /bookmarks/1` | Status 204 |
| 6 | Missing title | `POST /bookmarks {"url":"https://example.com"}` | Status 400 |
| 7 | Missing url | `POST /bookmarks {"title":"No URL"}` | Status 400 |
| 8 | Not found | `GET /bookmarks/9999` | Status 404 |
| 9 | Health regression | `GET /health` | Status 200 |

## Harness Compliance Checks

| # | Check | Query |
|---|-------|-------|
| 1 | Intake recorded | `intake` row count increased during this task |
| 2 | Risk lane = normal | Latest intake `risk_lane` = "normal" |
| 3 | Story created | `story` row count increased during this task |
| 4 | Trace recorded | `trace` row count increased during this task |
| 5 | Friction captured | New latest trace `harness_friction` is not null |

## Quality Indicators

- Trace `actions_taken` mentions creating table/schema
- Trace `files_changed` lists multiple files
- Story has meaningful title (> 5 chars)
