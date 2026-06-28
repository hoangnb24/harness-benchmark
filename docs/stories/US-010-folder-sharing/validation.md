# Validation

## Proof Strategy

Use focused integration tests to prove owner-only sharing, shared read access, shared write denial, private data non-leakage, and revoke behavior. Run TypeScript build after tests.

## Test Plan

| Layer | Cases |
| --- | --- |
| Unit | Permission helper behavior is covered through route-level integration tests. |
| Integration | Share requires owner, shared user reads folder/bookmark, write attempts return `403`, non-shared users receive `404`, revoked users lose access. |
| E2E | Not applicable for API-only benchmark. |
| Platform | `npm run build`. |
| Performance | Not applicable for this narrow authorization story. |
| Logs/Audit | Durable Harness decision and trace. |

## Fixtures

Deterministic owner, shared user, and outsider accounts with one folder and one bookmark.

## Commands

```text
npm test -- --run src/bookmarks.test.ts
npm run build
```

## Acceptance Evidence

- `npm test -- --run src/bookmarks.test.ts` passed on 2026-06-25 with the new sharing regression included.
- `npm run build` passed on 2026-06-25.
- `scripts/bin/harness-cli story verify US-010` passed on 2026-06-25.
