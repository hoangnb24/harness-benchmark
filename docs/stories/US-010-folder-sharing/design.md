# Design

## Domain Model

Folders remain owner-controlled records. A `folder_shares` record grants one target user read-only access to one folder. Ownership always outranks sharing: owners retain full CRUD behavior, while shared users receive read access only.

## Application Flow

Share commands require the authenticated user to own the folder before resolving the target email. Read queries check ownership or a matching `folder_shares` row before loading folder or bookmark data. Write commands continue to require ownership and explicitly return `403` when the requester has shared read access but not ownership.

## Interface Contract

- `POST /folders/:id/share` accepts `{ "email": "user@example.com" }` and returns `201` with the share record.
- `GET /shared/folders` returns folders shared with the authenticated user in creation order.
- `DELETE /folders/:id/share/:userId` revokes a share and returns `204`.
- `GET /folders/:id` returns a folder and bookmarks for owners or shared users.
- `GET /bookmarks/:id` returns a bookmark for owners or shared users when the bookmark is in a shared folder.
- Shared users receive `403` for write attempts against shared folders or bookmarks.
- Non-shared users receive `404` for private folder/bookmark reads and writes.

## Data Model

Add `folder_shares` with `folder_id`, `user_id`, and `created_at`, unique by `(folder_id, user_id)`. The table references `folders` and `users` and deletes shares when the folder is deleted.

## UI / Platform Impact

No browser, mobile, desktop, or CLI surface changes.

## Observability

Harness story, decision, tests, and trace record the authorization change. No product audit log exists yet.

## Alternatives Considered

1. Include shared bookmarks in `GET /bookmarks`: rejected because that endpoint is the owner's personal bookmark list and would blur ownership with shared visibility.
2. Filter private rows after loading by ID: rejected because authorization should be enforced in SQL predicates before private data is returned to application code.
