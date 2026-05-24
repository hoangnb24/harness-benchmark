# Task T3: Folder Support

## Context

You are continuing work on a Bookmark Manager API that already has working CRUD bookmark endpoints. Read `PRODUCT_SPEC.md` for the full specification.

## Task

Add folder support — bookmarks can optionally belong to a folder:

1. Create the `folders` table: `id` (integer primary key), `name` (text, required), `created_at` (text), `updated_at` (text)
2. Add a `folder_id` column (nullable integer, foreign key) to the `bookmarks` table
3. Implement folder endpoints:
   - `POST /folders` — Create a folder. Requires `name`. Returns 201.
   - `GET /folders` — List all folders. Returns 200 + array.
   - `GET /folders/:id` — Get folder with its bookmarks. Returns 200 or 404.
   - `PUT /folders/:id` — Update folder name. Returns 200 or 404.
   - `DELETE /folders/:id` — Delete folder. Bookmarks in that folder become unfoldered (folder_id = null). Returns 204 or 404.
4. Update `POST /bookmarks` and `PUT /bookmarks/:id` to accept optional `folder_id`
5. Validate that `folder_id` references an existing folder (return 400 if not)

## Acceptance Criteria

- All 5 folder CRUD endpoints work
- Bookmarks can be created with `folder_id`
- `GET /folders/:id` includes the folder's bookmarks
- Deleting a folder nullifies bookmarks' `folder_id` (not cascade delete)
- All previous bookmark endpoints still work (regression)
- Validation: non-existent `folder_id` → 400

## Notes

- Handle the schema migration carefully — the bookmarks table already has data
- Use a simple `ALTER TABLE` or recreate with the new column
- Keep existing bookmark tests passing
