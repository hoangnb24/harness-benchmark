# Task T9: Import / Export

## Context

You are continuing work on a Bookmark Manager API with tags and search. The API now has enough state that data portability and idempotency matter.

## Task

Add bookmark import/export:

1. `GET /export` returns the authenticated user's bookmarks, folders, and tags as JSON.
2. `POST /import` accepts that JSON format and imports bookmarks/folders/tags.
3. Import must be idempotent:
   - importing the same payload twice must not duplicate bookmarks, folders, tags, or tag links
   - dedupe bookmarks by normalized URL per user
4. Import should preserve folder and tag associations when possible.
5. Return a summary: `{ imported, skipped, updated }`.

## Acceptance Criteria

- Export includes bookmarks, folders, tags, and associations.
- Importing exported data into a fresh user recreates the data.
- Importing the same payload twice skips duplicates.
- Invalid import payloads return 400.
- User scoping is preserved.

## Notes

- JSON import/export is required. Netscape HTML import is optional.
- Normalize URLs consistently before dedupe.
