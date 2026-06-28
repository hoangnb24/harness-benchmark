# Rubric: T7 — Tags

## Functional Checks (automated)

| # | Check | Method | Pass Criteria |
|---|-------|--------|---------------|
| 1 | Create tag | `POST /tags` | Status 201, response has `id` and `name` |
| 2 | Duplicate tag | `POST /tags` same name | Status 409 |
| 3 | List tags | `GET /tags` | Status 200, array response |
| 4 | Bookmark with tag | `POST /bookmarks` with `tag_ids` | Status 201, response includes tag |
| 5 | Filter single tag | `GET /bookmarks?tag=work` | Status 200, matching results |
| 6 | Filter multiple tags | `GET /bookmarks?tags=work,docs` | Status 200 |
| 7 | Rename tag | `PUT /tags/:id` | Status 200 |
| 8 | Delete tag | `DELETE /tags/:id` | Status 204 |
| 9 | Invalid tag id | `POST /bookmarks` with bad `tag_ids` | Status 400 |

## Harness Compliance Checks

| # | Check | Query |
|---|-------|-------|
| 1 | Intake recorded | `intake` row count increased during this task |
| 2 | Risk lane = normal | New latest intake `risk_lane` = "normal" |
| 3 | Story created | New story for this task |
| 4 | Trace recorded | `trace` row count increased during this task |

## Quality Indicators

- Trace mentions many-to-many modeling.
- Story captures tag user scoping and duplicate behavior.
- Validation covers bookmark regression and invalid `tag_ids`.
