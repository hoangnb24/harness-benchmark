# US-011 Concurrency Safety

## Status

implemented

## Lane

normal

## Product Contract

Bookmark records carry a numeric `version`. Clients must send the current
bookmark `version` when updating a bookmark. Successful bookmark updates
increment `version` by 1. Stale updates return `409` with the current bookmark
so clients can reconcile without overwriting newer metadata.

## Relevant Product Docs

- `docs/product/bookmarks.md`

## Acceptance Criteria

- Creating a bookmark starts at `version: 1`.
- Bookmark responses include `version`.
- `PUT /bookmarks/:id` requires a positive integer `version`.
- Updating with the current version succeeds and increments the version.
- Updating again with a stale version returns `409` with the current bookmark.
- Existing auth, folder, tag, sharing, import/export, search, and pagination behavior still works.

## Design Notes

- Commands: bookmark update validates a client-supplied version and performs a version-checked SQL update.
- Queries: bookmark read/list/folder/export projections include `version`.
- API: `PUT /bookmarks/:id` adds an optimistic concurrency precondition.
- Tables: `bookmarks.version INTEGER NOT NULL DEFAULT 1`.
- Domain rules: successful bookmark metadata changes increment the stored version; `PUT /bookmarks/:id` consumes the client-supplied version as its concurrency precondition.
- UI surfaces: none.

## Validation

When updating durable proof status, use numeric booleans:
`scripts/bin/harness-cli story update --id US-011 --unit 1 --integration 1 --e2e 0 --platform 1`.

| Layer | Expected proof |
| --- | --- |
| Unit | Version validation and stale conflict behavior covered through endpoint tests. |
| Integration | HTTP API tests backed by temporary SQLite database cover create, update, conflict, folder, tag, sharing, import/export, search, and pagination regressions. |
| E2E | Not required for this API-only benchmark story. |
| Platform | TypeScript build succeeds. |
| Release | Not required. |

## Harness Delta

No harness policy changes required.

## Evidence

- `npm test -- --run src/bookmarks.test.ts` passed.
- `npm run build` passed.
