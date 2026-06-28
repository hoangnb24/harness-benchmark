# US-002 CRUD Bookmarks API

## Status

implemented

## Lane

normal

## Product Contract

The API supports creating, listing, reading, updating, and deleting bookmarks
stored in SQLite. Bookmarks require `url` and non-empty `title`, may include a
nullable `description`, and expose ISO `created_at` and `updated_at` fields.

## Relevant Product Docs

- `PRODUCT_SPEC.md`
- `docs/product/bookmarks.md`

## Acceptance Criteria

- All five bookmark CRUD endpoints return the expected HTTP status codes.
- Missing or empty required fields return `400` during bookmark creation.
- Missing bookmark IDs return `404` for read, update, and delete.
- `GET /health` still returns `{ "status": "ok" }`.
- Bookmark rows persist in SQLite.

## Design Notes

- Commands: create, update, and delete bookmark rows.
- Queries: list all bookmarks and fetch bookmark by ID.
- API: Express router mounted at `/bookmarks`.
- Tables: `bookmarks`.
- Domain rules: `url` and `title` are required on create; `title` cannot be empty.
- UI surfaces: none.

## Validation

When updating durable proof status, use numeric booleans:
`scripts/bin/harness-cli story update --id <id> --unit 1 --integration 1 --e2e 0 --platform 0`.

| Layer | Expected proof |
| --- | --- |
| Unit | Input validation behavior covered in Vitest. |
| Integration | HTTP CRUD flow covered against temporary SQLite database. |
| E2E | Not required for API-only slice. |
| Platform | TypeScript build. |
| Release | Not required. |

## Harness Delta

No harness changes required.

## Evidence

- `npm test -- --run src/bookmarks.test.ts` passed.
- `npm run build` passed.
