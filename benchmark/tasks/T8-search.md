# Task T8: Full-Text Search

## Context

You are continuing work on a Bookmark Manager API with tags. Read `PRODUCT_SPEC.md` and preserve existing bookmark, folder, auth, pagination, and tag behavior.

## Task

Add full-text search for bookmarks:

1. Add `q` query support to `GET /bookmarks`.
2. Search across bookmark `title`, `url`, `description`, folder name, and tag names.
3. Return paginated results in the existing envelope shape.
4. Add deterministic ranking:
   - exact title match first
   - title prefix match next
   - title substring match next
   - URL/description/tag/folder matches after title matches
5. Add validation:
   - empty `q` behaves like no search
   - queries longer than 200 characters return 400

## Acceptance Criteria

- `GET /bookmarks?q=docs` returns only matching bookmarks.
- Ranking is deterministic for equal data.
- Search combines with `tag`, `page`, and `limit`.
- Auth scoping is preserved.
- Existing list behavior still works when `q` is absent.

## Notes

- SQLite FTS is allowed but not required. A well-indexed `LIKE` implementation is acceptable for this benchmark.
- Avoid returning other users' bookmarks through search joins.
