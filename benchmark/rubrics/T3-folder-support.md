# Rubric: T3 — Folder Support

## Functional Checks (automated)

| # | Check | Method | Pass Criteria |
|---|-------|--------|---------------|
| 1 | Create folder | `POST /folders {"name":"Reading List"}` | Status 201 |
| 2 | List folders | `GET /folders` | Status 200 + array |
| 3 | Get folder | `GET /folders/1` | Status 200 + includes bookmarks |
| 4 | Update folder | `PUT /folders/1 {"name":"Updated"}` | Status 200 |
| 5 | Delete folder | `DELETE /folders/1` | Status 204 |
| 6 | Bookmark with folder | `POST /bookmarks {"url":"...","title":"...","folder_id":1}` | Status 201 |
| 7 | Bookmark regression | `GET /bookmarks` | Status 200 |
| 8 | Invalid folder_id | `POST /bookmarks {"url":"...","title":"...","folder_id":9999}` | Status 400 |

## Harness Compliance Checks

| # | Check | Query |
|---|-------|-------|
| 1 | Intake recorded | `intake` row count increased during this task |
| 2 | Risk lane = normal | New latest intake `risk_lane` = "normal" |
| 3 | Story created | New story for this task |
| 4 | Trace recorded | `trace` row count increased during this task |

## Quality Indicators

- Trace mentions schema migration / ALTER TABLE
- Trace `files_changed` lists 2+ files
- Story references the relationship between folders and bookmarks
