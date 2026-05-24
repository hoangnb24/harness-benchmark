# Task T2: CRUD Bookmarks

## Context

You are continuing work on a Bookmark Manager API. The project is set up with Express and SQLite (from previous work). Read `PRODUCT_SPEC.md` for the full specification.

## Task

Implement full CRUD operations for bookmarks:

1. Create the `bookmarks` table in SQLite with columns: `id` (integer primary key), `url` (text, required), `title` (text, required), `description` (text, nullable), `created_at` (text, ISO timestamp), `updated_at` (text, ISO timestamp)
2. Implement the following endpoints:
   - `POST /bookmarks` — Create a bookmark. Requires `url` and `title` in body. Returns 201 + created bookmark.
   - `GET /bookmarks` — List all bookmarks. Returns 200 + array.
   - `GET /bookmarks/:id` — Get single bookmark. Returns 200 or 404.
   - `PUT /bookmarks/:id` — Update a bookmark. Returns 200 + updated bookmark or 404.
   - `DELETE /bookmarks/:id` — Delete a bookmark. Returns 204 or 404.
3. Add input validation:
   - `POST /bookmarks` with missing `title` → 400
   - `POST /bookmarks` with missing `url` → 400
   - `POST /bookmarks` with empty `title` → 400

## Acceptance Criteria

- All 5 CRUD endpoints work correctly
- Validation returns 400 for missing/empty required fields
- `GET /health` still works (regression check)
- Data persists in SQLite (`data.db`)
- Proper HTTP status codes on all responses

## Notes

- Use `better-sqlite3` for database access (already in dependencies)
- Keep route handlers organized (separate file or clear structure)
- Return JSON responses with appropriate content-type
