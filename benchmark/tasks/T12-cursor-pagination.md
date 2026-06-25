# Task T12: Scale and Cursor Pagination

## Context

You are continuing work on a Bookmark Manager API with offset pagination. Offset pagination is less stable at scale and under inserts.

## Task

Add cursor pagination for bookmarks:

1. Keep existing `page`/`limit` pagination for backward compatibility.
2. Add cursor mode with `GET /bookmarks?cursor=<token>&limit=20`.
3. Return:
   ```json
   {
     "data": [...],
     "limit": 20,
     "nextCursor": "opaque-token-or-null",
     "hasMore": true
   }
   ```
4. Cursor tokens must be opaque to clients and stable across requests.
5. Use deterministic ordering by created time and id.
6. Avoid N+1 lookups for tags/folders on large result sets.

## Acceptance Criteria

- First cursor request returns `data`, `limit`, `nextCursor`, and `hasMore`.
- Following `nextCursor` returns the next page without duplicates.
- Invalid cursors return 400.
- Offset pagination remains backward-compatible.
- Tags and folder data are still present in bookmark responses.

## Notes

- This is normal lane but performance-sensitive.
- A base64-encoded JSON cursor is acceptable if signed or validated.
