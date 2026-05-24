# Rubric: T1 — Project Setup

## Functional Checks (automated)

| # | Check | Method | Pass Criteria |
|---|-------|--------|---------------|
| 1 | Dependencies installed | `[ -d node_modules ]` | Directory exists |
| 2 | Server starts | `npm run dev &` + wait | Process alive after 3s |
| 3 | Health endpoint | `GET /health` | Status 200 |
| 4 | Health response body | `GET /health` | Body contains `"status":"ok"` |
| 5 | SQLite DB accessible | `[ -f data.db ] OR sqlite3 data.db ".tables"` | No error |

## Harness Compliance Checks

| # | Check | Query |
|---|-------|-------|
| 1 | Intake recorded | `SELECT COUNT(*) FROM intake` > 0 |
| 2 | Risk lane = tiny | `SELECT risk_lane FROM intake ORDER BY id DESC LIMIT 1` = "tiny" |
| 3 | Trace recorded | `SELECT COUNT(*) FROM trace` > 0 |

## Quality Indicators

- Trace `task_summary` length > 10 characters
- Trace `actions_taken` is non-empty
- Trace `files_changed` lists at least 1 file
