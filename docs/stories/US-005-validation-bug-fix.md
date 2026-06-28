# US-005 Validation Bug Fix

## Status

implemented

## Lane

normal

## Product Contract

Bookmark and folder write endpoints reject missing, empty, whitespace-only, or
wrongly typed required string fields at the HTTP boundary with `400` JSON error
responses before attempting database writes.

## Relevant Product Docs

- `PRODUCT_SPEC.md`
- `docs/product/bookmarks.md`

## Acceptance Criteria

- `POST /bookmarks` rejects empty or whitespace-only `title` with `400`.
- `POST /bookmarks` rejects empty or whitespace-only `url` with `400`.
- `PUT /bookmarks/:id` rejects provided empty or whitespace-only `title` or
  `url` with `400`.
- `POST /folders` rejects empty or whitespace-only `name` with `400`.
- `PUT /folders/:id` rejects provided empty or whitespace-only `name` with
  `400`.
- Validation failures include a JSON `error` field.

## Design Notes

- Commands: bookmark and folder create/update validation before SQL writes.
- Queries: existing bookmark and folder reads unchanged.
- API: REST JSON under `/bookmarks` and `/folders`.
- Tables: no schema changes.
- Domain rules: required strings must be non-empty after trimming.
- UI surfaces: none.

## Validation

When updating durable proof status, use numeric booleans:
`scripts/bin/harness-cli story update --id US-005 --unit 1 --integration 1 --e2e 0 --platform 1`.

| Layer | Expected proof |
| --- | --- |
| Unit | Vitest route-level validation assertions. |
| Integration | HTTP API tests backed by temporary SQLite database. |
| E2E | Not applicable for API-only benchmark task. |
| Platform | TypeScript build. |
| Release | Not applicable. |

## Harness Delta

No harness changes required.

## Evidence

- `npm test -- --run src/bookmarks.test.ts` passed.
- `npm run build` passed.
