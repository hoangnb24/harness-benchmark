# Task T6: Pagination

## Context

You are continuing work on a Bookmark Manager API with full CRUD, folders, authentication, and validation. Read `PRODUCT_SPEC.md` for the full specification.

## Task

Refactor the `GET /bookmarks` endpoint to support pagination:

1. Change the response format from a plain array to a paginated envelope:
   ```json
   {
     "data": [...],
     "page": 1,
     "limit": 20,
     "total": 45
   }
   ```
2. Accept query parameters:
   - `page` (integer, default: 1, minimum: 1)
   - `limit` (integer, default: 20, minimum: 1, maximum: 100)
3. Implement proper SQL OFFSET/LIMIT pagination
4. Return correct `total` count (total bookmarks for this user, not just current page)
5. Validate query parameters:
   - `page=0` or `page=-1` → 400
   - `limit=0` or `limit=200` → 400
   - Non-numeric values → 400 or use defaults

## Acceptance Criteria

- `GET /bookmarks` returns paginated envelope (not raw array)
- Default pagination: page=1, limit=20
- `GET /bookmarks?page=2&limit=5` returns correct offset
- `total` reflects actual total count, not page count
- Invalid page/limit values → 400
- All other endpoints still work (including auth)
- Response includes all expected fields: `data`, `page`, `limit`, `total`

## Notes

- This is a refactoring task — the endpoint behavior changes for ALL callers
- The `GET /folders/:id` endpoint (which returns bookmarks) does NOT need pagination yet
- Consider: should the `GET /folders` endpoint also be paginated? (No — keep it simple)
- SQL: `SELECT COUNT(*) FROM bookmarks WHERE user_id = ?` for total
- SQL: `SELECT * FROM bookmarks WHERE user_id = ? LIMIT ? OFFSET ?` for page data
