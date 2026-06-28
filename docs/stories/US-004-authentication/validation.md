# US-004 Authentication Validation

## Proof Strategy

Use integration tests against a temporary SQLite database to prove auth endpoint
status codes, password hashing, JWT login, protected-route rejection, and
cross-user data isolation. Use the TypeScript build as platform proof.

## Test Plan

| Layer | Cases |
| --- | --- |
| Unit | Input validation behavior is covered through route-level integration tests. |
| Integration | Register, login, duplicate email, invalid credentials, missing/invalid token, authenticated bookmark/folder CRUD, and cross-user isolation. |
| E2E | Not required for API-only benchmark slice. |
| Platform | TypeScript build. |
| Performance | Not required. |
| Logs/Audit | Not required; no audit contract in this slice. |

## Fixtures

- Deterministic test users with unique email addresses.
- Temporary SQLite database per test run.

## Commands

```text
npm test -- --run src/bookmarks.test.ts
npm run build
```

## Acceptance Evidence

- `npm test -- --run src/bookmarks.test.ts` passed.
- `npm run build` passed.
