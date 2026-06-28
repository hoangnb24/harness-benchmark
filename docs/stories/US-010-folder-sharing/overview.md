# Overview

## Current Behavior

Folders, bookmarks, and tags are scoped to the authenticated owner. Other users cannot read or mutate private records.

## Target Behavior

Folder owners can share a folder read-only with another registered user by email. Shared users can list folders shared with them and read a shared folder with its bookmarks. Shared users cannot create, update, delete, import into, or tag bookmarks in the shared folder. Owners can revoke a share.

## Affected Users

- Folder owners.
- Shared read-only users.

## Affected Product Docs

- `docs/product/bookmarks.md`

## Non-Goals

- Public or link-based sharing.
- Shared tag management.
- Sharing unfoldered bookmarks.
- Writable collaboration.
