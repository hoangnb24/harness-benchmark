# US-008 Full-Text Search

## Status

implemented

## Lane

normal

## Product Contract

Authenticated users can search their bookmark list with `GET /bookmarks?q=...`.
Search matches bookmark title, URL, description, folder name, and tag names while
preserving user scoping, tag filters, and pagination.

## Relevant Product Docs

- `docs/product/bookmarks.md`

## Acceptance Criteria

- `GET /bookmarks?q=docs` returns only matching bookmarks.
- Ranking is deterministic: exact title, title prefix, title substring, then
  other field matches, with ID order as a tie-breaker.
- Search combines with `tag`, `page`, and `limit`.
- Auth scoping is preserved across folder and tag search joins.
- Existing list behavior still works when `q` is absent or empty.
- Queries longer than 200 characters return `400`.

## Design Notes

- Commands: none.
- Queries: bookmark list adds an optional literal `LIKE` search filter and
  search-specific ranking expression.
- API: additive `q` query parameter on `GET /bookmarks`.
- Tables: no schema changes.
- Domain rules: empty search is ignored; search is scoped to authenticated user
  bookmarks before related folder or tag matches are considered.
- UI surfaces: none.

## Validation

When updating durable proof status, use numeric booleans:
`scripts/bin/harness-cli story update --id US-008 --unit 1 --integration 1 --e2e 0 --platform 1`.

| Layer | Expected proof |
| --- | --- |
| Unit | Search query parsing and SQL composition covered through route tests. |
| Integration | `src/bookmarks.test.ts` covers search fields, ranking, tag/pagination composition, auth isolation, empty search, and length validation. |
| E2E | Not required for this API-only benchmark task. |
| Platform | `npm run build`. |
| Release | Not required. |

## Harness Delta

No harness changes were needed.

## Evidence

- `npm test -- --run src/bookmarks.test.ts` passed.
- `npm run build` passed.
- `scripts/bin/harness-cli story verify US-008` passed.
