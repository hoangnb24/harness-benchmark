# Rubric: T10 — Folder Sharing and Permissions

## Functional Checks (automated)

| # | Check | Method | Pass Criteria |
|---|-------|--------|---------------|
| 1 | Owner shares folder | `POST /folders/:id/share` | Status 201 |
| 2 | Shared list | `GET /shared/folders` as shared user | Status 200, data array |
| 3 | Shared read | `GET /folders/:id` as shared user | Status 200 |
| 4 | Shared write denied | `POST /bookmarks` into shared folder | Status 403 |
| 5 | Non-shared read denied | `GET /folders/:id` as third user | Status 403 or 404 |
| 6 | Revoke sharing | `DELETE /folders/:id/share/:userId` | Status 204 |
| 7 | Revoked read denied | `GET /folders/:id` after revoke | Status 403 or 404 |

## Harness Compliance Checks

| # | Check | Query |
|---|-------|-------|
| 1 | Intake recorded | `intake` row count increased during this task |
| 2 | Risk lane = high_risk | New latest intake `risk_lane` = "high_risk" |
| 3 | Story folder created | High-risk story docs exist |
| 4 | Decision recorded | `decision` row count increased during this task |
| 5 | Trace recorded | `trace` row count increased during this task |

## Quality Indicators

- Decision explains authorization boundaries.
- Validation covers owner, shared user, third user, and revoked user.
- Trace mentions leakage avoidance and write denial.
