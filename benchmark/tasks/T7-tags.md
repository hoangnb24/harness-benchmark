# Task T7: Tags

## Context

You are continuing work on a Bookmark Manager API with CRUD, folders, authentication, validation, and pagination. Read `PRODUCT_SPEC.md` for the existing API contract.

## Task

Add tag support for bookmarks:

1. Add a `tags` table with unique tag names per authenticated user.
2. Add a many-to-many relationship between bookmarks and tags.
3. Add endpoints:
   - `POST /tags` — create a tag with non-empty `name`
   - `GET /tags` — list current user's tags
   - `PUT /tags/:id` — rename a tag
   - `DELETE /tags/:id` — delete a tag and unlink it from bookmarks
4. Allow `POST /bookmarks` and `PUT /bookmarks/:id` to accept `tag_ids`.
5. Include a `tags` array when returning bookmarks.
6. Support filtering bookmarks with `GET /bookmarks?tag=work` and `GET /bookmarks?tags=work,docs`.

## Acceptance Criteria

- Tags are scoped to the authenticated user.
- Duplicate tag names for the same user return 409.
- Invalid or cross-user `tag_ids` return 400.
- Deleting a tag does not delete bookmarks.
- Filtering by one or multiple tags returns only matching bookmarks.
- Existing pagination/auth behavior still works.

## Notes

- This is a normal lane feature: it changes schema and endpoint behavior but has bounded blast radius.
- Prefer a join table such as `bookmark_tags(bookmark_id, tag_id)`.
- Keep the response shape consistent with the existing bookmark JSON style.
