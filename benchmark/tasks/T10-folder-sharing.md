# Task T10: Folder Sharing and Permissions

## Context

You are continuing work on a Bookmark Manager API with auth, folders, tags, search, and import/export. This task changes authorization behavior and is high-risk.

## Task

Add read-only folder sharing between users:

1. Add `POST /folders/:id/share` to share a folder with another user's email.
2. Add `GET /shared/folders` to list folders shared with the authenticated user.
3. Shared users can read the shared folder and its bookmarks.
4. Shared users cannot create, update, delete, import into, or tag bookmarks inside the shared folder.
5. Owners can revoke sharing with `DELETE /folders/:id/share/:userId`.
6. Owners retain full control over their folders.

## Acceptance Criteria

- Sharing requires folder ownership.
- A shared user can read the shared folder.
- A shared user receives 403 for write attempts.
- Non-shared users receive 404 or 403 without leaking private data.
- Revoked users lose access.
- A durable decision is recorded because authorization behavior changes.

## Notes

- This is high-risk because it touches authorization and data access boundaries.
- Create the high-risk story packet before implementation.
- Prefer explicit permission checks over filtering after data has already been loaded.
