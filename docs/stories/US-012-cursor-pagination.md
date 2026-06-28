# US-012 Cursor Pagination

## Status

implemented

## Lane

normal

## Product Contract

`GET /bookmarks` keeps existing offset pagination and adds cursor pagination
for scale-sensitive clients. Cursor mode returns a page envelope with `data`,
`limit`, `nextCursor`, and `hasMore`, ordered deterministically by bookmark
creation time and ID.

## Relevant Product Docs

- `docs/product/bookmarks.md`

## Acceptance Criteria

- First cursor request returns `data`, `limit`, `nextCursor`, and `hasMore`.
- Following `nextCursor` returns the next page without duplicates.
- Invalid cursors return `400`.
- Offset pagination remains backward-compatible.
- Tags and folder data remain present in bookmark responses.

## Design Notes

- Commands: no write-command behavior changed.
- Queries: cursor list fetches `limit + 1` rows with `(created_at, id)` seek
  predicates and hydrates tags for the page in one batched query.
- API: `GET /bookmarks` uses cursor mode only when the `cursor` query
  parameter is present; existing `page` and `limit` offset responses remain.
- Tables: no schema changes.
- Domain rules: cursor tokens are signed base64url payloads and must validate
  before use.
- UI surfaces: none.

## Validation

When updating durable proof status, use numeric booleans:
`scripts/bin/harness-cli story update --id US-012 --unit 1 --integration 1 --e2e 0 --platform 1`.

| Layer | Expected proof |
| --- | --- |
| Unit | Cursor token validation and query parameter behavior covered through endpoint tests. |
| Integration | HTTP API tests backed by temporary SQLite database cover cursor paging, invalid cursors, offset compatibility, and tag/folder response preservation. |
| E2E | Not required for this API-only benchmark story. |
| Platform | TypeScript build succeeds. |
| Release | Not required. |

## Harness Delta

No harness policy changes expected.

## Evidence

- `npm test -- --run src/bookmarks.test.ts` passed.
- `npm run build` passed.
