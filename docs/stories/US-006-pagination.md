# US-006 Pagination

## Status

implemented

## Lane

normal

## Product Contract

`GET /bookmarks` returns a paginated envelope for the authenticated user's
bookmarks instead of a raw array. The envelope includes the current `data`
slice, the requested `page`, the requested `limit`, and the user's full
bookmark `total`.

## Relevant Product Docs

- `docs/product/bookmarks.md`

## Acceptance Criteria

- `GET /bookmarks` returns `{ data, page, limit, total }`.
- Default pagination is `page=1` and `limit=20`.
- `GET /bookmarks?page=2&limit=5` applies SQL offset pagination.
- `total` counts all bookmarks owned by the authenticated user, not only the
  current page.
- Invalid `page` or `limit` values return `400`.
- Bookmark authentication, CRUD, folder behavior, and validation still work.

## Design Notes

- Commands: no write-command behavior changed.
- Queries: bookmark list performs one user-scoped `COUNT(*)` query and one
  user-scoped `LIMIT/OFFSET` query.
- API: `GET /bookmarks` response shape changes for all callers.
- Tables: no schema changes.
- Domain rules: pagination applies only to the bookmark list endpoint; folder
  list and folder detail bookmark lists remain unpaginated.
- UI surfaces: none.

## Validation

When updating durable proof status, use numeric booleans:
`scripts/bin/harness-cli story update --id US-006 --unit 1 --integration 1 --e2e 0 --platform 1`.

| Layer | Expected proof |
| --- | --- |
| Unit | Query parameter parser behavior covered through endpoint tests. |
| Integration | `GET /bookmarks` envelope, offset, total, invalid parameters, auth, CRUD, and folder regressions in `src/bookmarks.test.ts`. |
| E2E | Not required for this API-only benchmark story. |
| Platform | TypeScript build succeeds. |
| Release | Not required. |

## Harness Delta

No harness changes were required.

## Evidence

- `npm test -- --run src/bookmarks.test.ts` passed.
- `npm run build` passed.
- `scripts/bin/harness-cli story verify US-006` passed.
- `npm test` passed.
