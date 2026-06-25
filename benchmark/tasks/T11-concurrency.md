# Task T11: Concurrency Safety

## Context

You are continuing work on a Bookmark Manager API with sharing. Concurrent edits can now overwrite important metadata and permissions-adjacent state.

## Task

Add optimistic concurrency control for bookmark updates:

1. Add a numeric `version` field to bookmarks.
2. Include `version` in bookmark responses.
3. Require `version` on `PUT /bookmarks/:id`.
4. If the supplied version does not match the current version, return 409 with the current bookmark.
5. Successful updates increment `version` by 1.

## Acceptance Criteria

- Creating a bookmark starts at `version: 1`.
- Updating with the current version succeeds and increments the version.
- Updating again with the stale version returns 409.
- Conflict responses include the current bookmark.
- Auth, folder, tag, and pagination behavior still works.

## Notes

- This is normal lane: it changes an existing write contract and needs careful regression checks.
- Use a SQL `WHERE id = ? AND version = ?` update or equivalent transaction-safe approach.
