# US-007 Tags

## Status

implemented

## Lane

normal

## Product Contract

Authenticated users can create, list, rename, and delete their own tags. Tags
can be attached to bookmarks through `tag_ids`; bookmark responses include a
`tags` array. Bookmark lists can be filtered by one tag name or a comma-separated
set of tag names while preserving the existing pagination envelope.

## Relevant Product Docs

- `PRODUCT_SPEC.md`
- `docs/product/bookmarks.md`

## Acceptance Criteria

- Tags are scoped to the authenticated user.
- Duplicate tag names for the same user return `409`.
- Invalid or cross-user `tag_ids` return `400`.
- Deleting a tag unlinks it from bookmarks without deleting bookmarks.
- `GET /bookmarks?tag=work` filters by one tag.
- `GET /bookmarks?tags=work,docs` filters by multiple tag names.
- Existing pagination, authentication, bookmark, and folder behavior still works.

## Design Notes

- Commands: tag create, rename, delete; bookmark create/update with optional tag replacement.
- Queries: tag list; bookmark list with optional tag-name filter; bookmark responses hydrated with tags.
- API: REST JSON under `/tags` and additive `tag_ids` support under `/bookmarks`.
- Tables: new `tags` table and `bookmark_tags` join table.
- Domain rules: tag names are unique per user; tag IDs must belong to the authenticated user.
- UI surfaces: none.

## Validation

When updating durable proof status, use numeric booleans:
`scripts/bin/harness-cli story update --id US-007 --unit 1 --integration 1 --e2e 0 --platform 1`.

| Layer | Expected proof |
| --- | --- |
| Unit | Validation and filtering behavior covered through endpoint tests. |
| Integration | HTTP API tests backed by temporary SQLite database. |
| E2E | Not required for this API-only benchmark story. |
| Platform | TypeScript build succeeds. |
| Release | Not required. |

## Harness Delta

No harness policy changes expected.

## Evidence

- `npm test -- --run src/bookmarks.test.ts` passed.
- `npm run build` passed.
- `scripts/bin/harness-cli story verify US-007` passed.
