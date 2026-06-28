# US-003 Folder Support

## Status

implemented

## Lane

normal

## Product Contract

Bookmarks can optionally belong to a folder. Folders are persisted records with a
required non-empty name and timestamp metadata. Deleting a folder unfolders its
bookmarks instead of deleting them.

## Relevant Product Docs

- `PRODUCT_SPEC.md`
- `docs/product/bookmarks.md`

## Acceptance Criteria

- `POST /folders`, `GET /folders`, `GET /folders/:id`, `PUT /folders/:id`, and `DELETE /folders/:id` work with expected status codes.
- Bookmarks can be created and updated with optional `folder_id`.
- `GET /folders/:id` includes the folder's bookmarks.
- Deleting a folder sets matching bookmarks' `folder_id` to null.
- Non-existent bookmark `folder_id` input returns `400`.
- Existing bookmark CRUD behavior remains covered.

## Design Notes

- Commands: folder create, update, delete; bookmark create/update with optional folder assignment.
- Queries: list folders; fetch one folder with bookmarks; list/get bookmarks with `folder_id`.
- API: REST JSON under `/folders` and existing `/bookmarks`.
- Tables: new `folders`; additive nullable `bookmarks.folder_id` foreign key.
- Domain rules: folder names are required; bookmarks may be unfoldered.
- UI surfaces: none.

## Validation

When updating durable proof status, use numeric booleans:
`scripts/bin/harness-cli story update --id US-003 --unit 1 --integration 1 --e2e 0 --platform 1`.

| Layer | Expected proof |
| --- | --- |
| Unit | Vitest validation coverage for folder and `folder_id` rules |
| Integration | HTTP API tests backed by temporary SQLite database |
| E2E | Not applicable for API-only benchmark task |
| Platform | TypeScript build |
| Release | Not applicable |

## Harness Delta

No harness policy changes expected.

## Evidence

- `scripts/bin/harness-cli story verify US-003` passed:
  `npm test -- --run src/bookmarks.test.ts && npm run build`.
- `npm test` passed across the current workspace test discovery.
