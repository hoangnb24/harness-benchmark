# US-009 Import Export

## Status

implemented

## Lane

normal

## Product Contract

Authenticated users can export their folders, tags, bookmarks, and bookmark-tag
associations as JSON. They can import the same JSON shape into their own account
without duplicating folders, tags, bookmarks, or tag links.

## Relevant Product Docs

- `docs/product/bookmarks.md`

## Acceptance Criteria

- `GET /export` includes bookmarks, folders, tags, and associations.
- `POST /import` recreates exported data for a fresh authenticated user.
- Importing the same payload twice skips duplicates.
- Invalid import payloads return `400`.
- User scoping is preserved.

## Design Notes

- Commands: import folders, tags, bookmarks, and bookmark-tag links in one transaction.
- Queries: export the authenticated user's folders, tags, bookmarks, and tag IDs.
- API: root-level authenticated JSON endpoints at `/export` and `/import`.
- Tables: no schema change; import maps source IDs to current-user IDs.
- Domain rules: folders and tags dedupe by name; bookmarks dedupe by normalized URL per user.
- UI surfaces: none.

## Validation

When updating durable proof status, use numeric booleans:
`scripts/bin/harness-cli story update --id <id> --unit 1 --integration 1 --e2e 0 --platform 0`.

| Layer | Expected proof |
| --- | --- |
| Unit | URL normalization and import parser are covered through focused integration cases. |
| Integration | `src/bookmarks.test.ts` covers export shape, fresh-user import, duplicate import idempotency, invalid payloads, and user scoping. |
| E2E | Not required for API-only benchmark task. |
| Platform | `npm run build` proves TypeScript compilation. |
| Release | Not required. |

## Harness Delta

None.

## Evidence

- `npm test -- --run src/bookmarks.test.ts` passed. Vitest also discovered
  checkpoint copies under `benchmark/runs`.
- `npm run build` passed.
- `scripts/bin/harness-cli story verify US-009` passed.
