# 0009 Read-Only Folder Sharing

Date: 2026-06-25

## Status

Accepted

## Context

Folder sharing changes the authorization model from strict owner-only visibility to owner-controlled read delegation. The change must avoid exposing private folders to non-shared users and must preserve owner-only writes for folders, bookmarks, tags, and import/export workflows.

## Decision

Represent sharing with a `folder_shares` table keyed by `(folder_id, user_id)`. Owners can create and revoke share rows. Shared users can read the shared folder and bookmarks in that folder, but all writes still require ownership. Read queries use SQL predicates that prove ownership or sharing before loading folder or bookmark records.

## Alternatives Considered

1. Copy bookmarks to the target user: rejected because copies would drift from the owner's folder and confuse import/export ownership.
2. Add shared folders to every bookmark list/search query: rejected because `GET /bookmarks` remains the authenticated user's owned collection.
3. Load private rows first and filter in application code: rejected because authorization should be checked before private data is loaded.

## Consequences

Positive:

- Owners keep full control over their folders.
- Shared users get read-only access with explicit `403` responses for write attempts.
- Non-shared users do not learn whether private records exist through read responses.

Tradeoffs:

- Shared folders are visible through dedicated shared-folder and direct read endpoints, not mixed into the owner's existing bookmark list.
- The current product still lacks a separate audit log for share/revoke events.

## Follow-Up

- Add product audit logs if the benchmark later introduces audit/security observability.
