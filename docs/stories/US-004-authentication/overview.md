# US-004 Authentication Overview

## Current Behavior

Bookmark and folder records are global API data. Any caller can create, list,
read, update, and delete all bookmarks and folders without credentials.

## Target Behavior

Users can register with an email and password, login to receive a JWT, and use
that token to access bookmark and folder endpoints. Bookmark and folder records
are owned by one user and are visible or mutable only by that user.

## Affected Users

- API consumers managing personal bookmarks.

## Affected Product Docs

- `PRODUCT_SPEC.md`
- `docs/product/bookmarks.md`

## Non-Goals

- Password reset.
- Refresh tokens.
- Role-based permissions.
- Migrating existing non-benchmark production data.
