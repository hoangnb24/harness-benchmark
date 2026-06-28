# Bookmarks

## Contract

Bookmarks are persisted user-owned URL records with a required `url`, required
non-empty `title`, optional `description`, optional `folder_id`, `tags`, and
numeric `version` plus ISO timestamp metadata.

Folders are persisted user-owned named collections of bookmarks. A bookmark may
be unfoldered with `folder_id: null`. Folder owners may share a folder
read-only with another registered user.

Users are authenticated accounts with a unique email and hashed password.
Bookmark, folder, and tag write endpoints only mutate records owned by the
authenticated user. Folder and direct bookmark read endpoints may also expose
records in folders shared read-only with the authenticated user.

Tags are user-owned labels with unique names per user. Bookmarks and tags have a
many-to-many relationship; deleting a tag unlinks it from bookmarks without
deleting those bookmarks.

## API

- `POST /auth/register` creates a user and returns `201` with the public user JSON object.
- `POST /auth/login` authenticates a user and returns `200` with a JWT token.
- `POST /bookmarks` creates a bookmark and returns `201` with the created JSON object. It accepts optional `tag_ids`.
- `GET /bookmarks` returns `200` with `{ data, page, limit, total }` for
  offset pagination, where `data` contains the authenticated user's bookmarks
  in creation order unless a search query is present.
- `GET /bookmarks?cursor=&limit=20` returns `200` with
  `{ data, limit, nextCursor, hasMore }` for cursor pagination. `nextCursor`,
  when present, is an opaque token that fetches the next page through
  `GET /bookmarks?cursor=<token>&limit=20`.
- `GET /bookmarks/:id` returns `200` with one bookmark or `404` when it does not exist.
- `PUT /bookmarks/:id` updates a bookmark and returns `200` with the updated JSON object, `409` with the current bookmark on a version conflict, or `404`. It requires `version` and accepts optional `tag_ids`.
- `DELETE /bookmarks/:id` deletes a bookmark and returns `204` or `404`.
- `POST /folders` creates a folder and returns `201`.
- `GET /folders` returns `200` with all folders in creation order.
- `GET /folders/:id` returns `200` with one folder and its bookmarks or `404`.
- `POST /folders/:id/share` shares an owned folder with a registered user by email and returns `201`.
- `GET /shared/folders` returns `200` with folders shared with the authenticated user.
- `DELETE /folders/:id/share/:userId` revokes a folder share and returns `204`.
- `PUT /folders/:id` updates a folder name and returns `200` or `404`.
- `DELETE /folders/:id` deletes a folder and returns `204` or `404`; bookmarks in the deleted folder become unfoldered.
- `POST /tags` creates a tag and returns `201`.
- `GET /tags` returns `200` with all tags in creation order.
- `PUT /tags/:id` renames a tag and returns `200` or `404`.
- `DELETE /tags/:id` deletes a tag and returns `204` or `404`; bookmarks using the deleted tag remain.
- `GET /export` returns the authenticated user's folders, tags, bookmarks, and
  bookmark-tag associations as JSON.
- `POST /import` accepts the `GET /export` JSON shape and returns
  `{ imported, skipped, updated }`.

## Validation

- Auth registration and login require a valid email and a password of at least
  8 characters.
- Duplicate registration email returns `409`.
- Invalid login credentials return `401`.
- `/bookmarks` and `/folders` require `Authorization: Bearer <token>` and return
  `401` when the token is missing or invalid.
- `GET /bookmarks` accepts optional `page` and `limit` query parameters.
  `page` defaults to `1` and must be a positive integer. `limit` defaults to
  `20`, must be a positive integer, and cannot exceed `100`.
- `GET /bookmarks` uses offset pagination unless the `cursor` query parameter
  is present. Cursor pagination uses deterministic `(created_at, id)` ordering,
  returns `nextCursor: null` when no further page exists, and returns `400` for
  malformed non-empty cursor tokens.
- `GET /bookmarks` accepts optional `tag=work` and `tags=work,docs` filters.
  Multiple tag names match bookmarks that have any listed tag.
- `GET /bookmarks` accepts optional `q=docs` search. Empty or whitespace-only
  `q` behaves like no search. `q` longer than 200 characters returns `400`.
  Search matches bookmark `title`, `url`, `description`, folder name, and tag
  names for the authenticated user's bookmarks only.
- Search results are ranked deterministically: exact title matches first, title
  prefix matches second, title substring matches third, and URL, description,
  tag, or folder matches after title matches. Equal-rank results sort by
  bookmark ID.
- `POST /bookmarks` requires a non-empty string `url`.
- `POST /bookmarks` requires a non-empty string `title`.
- `PUT /bookmarks/:id` rejects `url` or `title` when either field is provided
  as a non-string, empty string, or whitespace-only string.
- Bookmark responses include a numeric `version`. Created bookmarks start at
  `version: 1`.
- `PUT /bookmarks/:id` requires a positive integer `version` matching the
  current bookmark version. Successful updates increment `version` by 1.
- `PUT /bookmarks/:id` returns `409` with the current bookmark when the
  supplied `version` is stale.
- `POST /bookmarks` and `PUT /bookmarks/:id` accept optional `folder_id`.
- `folder_id`, when provided as a number, must reference an existing folder
  owned by the authenticated user.
- Shared folders are read-only. Shared users can read a shared folder and
  direct bookmark records in that folder, but cannot create bookmarks in it,
  update bookmarks in it, delete bookmarks in it, tag bookmarks in it, update
  the folder, or delete the folder.
- Non-shared users receive `404` for private folder and bookmark reads.
- Folder sharing requires ownership and a registered target user email.
- Revoked shared users lose read access.
- `POST /bookmarks` and `PUT /bookmarks/:id` accept optional `tag_ids`.
- `tag_ids`, when provided, must be an array of positive integer tag IDs owned
  by the authenticated user.
- `description` may be omitted or null.
- Folder `name` must be a non-empty string when creating a folder or when
  `name` is provided during folder update.
- Tag `name` must be a non-empty string.
- Duplicate tag names for the same authenticated user return `409`.
- Import payloads must contain `version: 1`, `folders`, `tags`, and
  `bookmarks` arrays. Invalid payloads or broken folder/tag associations return
  `400`.
- Import is idempotent for one authenticated user. Tags and folders dedupe by
  name, bookmarks dedupe by normalized URL, and bookmark-tag links are synced
  without duplication.
- Import ignores source `user_id` values and always creates or updates records
  for the authenticated user only.

## Storage

SQLite `data.db` contains a `users` table with `id`, `email`, `password_hash`,
and `created_at`.

SQLite `data.db` contains a `bookmarks` table with `id`, `user_id`, `url`,
`title`, `description`, `folder_id`, `version`, `created_at`, and
`updated_at`.

SQLite `data.db` contains a `folders` table with `id`, `user_id`, `name`,
`created_at`, and `updated_at`.

SQLite `data.db` contains a `tags` table with `id`, `user_id`, `name`,
`created_at`, and `updated_at`, unique by `(user_id, name)`.

SQLite `data.db` contains a `bookmark_tags` join table with `bookmark_id` and
`tag_id`.

SQLite `data.db` contains a `folder_shares` join table with `folder_id`,
`user_id`, and `created_at`, unique by `(folder_id, user_id)`.
