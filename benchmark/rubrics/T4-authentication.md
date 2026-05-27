# Rubric: T4 — Authentication

## Functional Checks (automated)

| # | Check | Method | Pass Criteria |
|---|-------|--------|---------------|
| 1 | Register | `POST /auth/register {"email":"test@test.com","password":"secret123"}` | Status 201 |
| 2 | Duplicate email | `POST /auth/register` (same email) | Status 409 |
| 3 | Login | `POST /auth/login {"email":"test@test.com","password":"secret123"}` | Status 200 + has `token` |
| 4 | Wrong password | `POST /auth/login {"email":"test@test.com","password":"wrong"}` | Status 401 |
| 5 | Protected GET | `GET /bookmarks` (no auth) | Status 401 |
| 6 | Authed GET | `GET /bookmarks` (with token) | Status 200 |
| 7 | Short password | `POST /auth/register {"email":"x@x.com","password":"short"}` | Status 400 |
| 8 | Create with auth | `POST /bookmarks` (with token + valid data) | Status 201 |
| 9 | User isolation | Create bookmark as user A, list as user B → not visible | Correct |

## Harness Compliance Checks

| # | Check | Query |
|---|-------|-------|
| 1 | Intake recorded | `intake` row count increased during this task |
| 2 | Risk lane = high_risk | New latest intake `risk_lane` = "high_risk" |
| 3 | Story created | New story for this task |
| 4 | Decision recorded | `decision` row count increased during this task |
| 5 | Trace recorded | `trace` row count increased during this task |
| 6 | High-risk docs | Story folder has overview/design/execplan/validation |

## Quality Indicators

- Decision record explains auth strategy choice (JWT vs sessions)
- Trace `actions_taken` is detailed (> 50 chars)
- Story has explicit acceptance criteria
- Trace mentions security considerations
