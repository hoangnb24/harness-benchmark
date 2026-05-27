# Rubric: T5 — Bug Fix

## Functional Checks (automated)

| # | Check | Method | Pass Criteria |
|---|-------|--------|---------------|
| 1 | Empty title rejected | `POST /bookmarks {"url":"https://example.com","title":""}` (authed) | Status 400 (not 500) |
| 2 | Empty url rejected | `POST /bookmarks {"url":"","title":"Test"}` (authed) | Status 400 |
| 3 | Empty folder name | `POST /folders {"name":""}` (authed) | Status 400 |
| 4 | Whitespace title | `POST /bookmarks {"url":"https://example.com","title":"   "}` (authed) | Status 400 |
| 5 | Valid still works | `POST /bookmarks {"url":"https://example.com","title":"Valid"}` (authed) | Status 201 |
| 6 | Error has message | Response body of 400 | Has `error` or `message` field |
| 7 | Auth still works | `POST /auth/login` with valid creds | Status 200 |

## Harness Compliance Checks

| # | Check | Query |
|---|-------|-------|
| 1 | Intake recorded | `intake` row count increased during this task |
| 2 | Risk lane = normal | New latest intake `risk_lane` = "normal" |
| 3 | Trace recorded | `trace` row count increased during this task |
| 4 | Friction captured | New latest trace has `harness_friction` comment |

## Quality Indicators

- Trace `task_summary` mentions the specific bug (empty string validation)
- Trace `errors` field documents the root cause
- Fix is targeted (few files changed, not a massive refactor)
