# 0008 JWT User Ownership

Date: 2026-06-25

## Status

Accepted

## Context

Authentication changes every bookmark and folder endpoint from public global
data to user-owned data. The benchmark task explicitly allows a hardcoded JWT
secret and a fresh database per run, but existing local databases should not
crash during development.

## Decision

Use bcryptjs to hash passwords, jsonwebtoken to issue JWTs containing `userId`,
and a Bearer-token Express middleware for all `/bookmarks` and `/folders`
routes. Add `users`, `bookmarks.user_id`, and `folders.user_id`; all bookmark
and folder SQL must include the authenticated `user_id` for reads and writes.

## Alternatives Considered

1. Cookie sessions: rejected because the product spec requires JWT login.
2. One global default user for existing records: rejected because the benchmark
   accepts fresh databases and default ownership would hide authorization bugs.

## Consequences

Positive:

- Auth and ownership are enforced at every existing bookmark/folder endpoint.
- Existing CRUD and folder behavior remains available with a valid token.

Tradeoffs:

- The JWT secret is hardcoded for benchmark simplicity and is not production
  secret management.
- Existing non-owned rows in a reused local database are no longer visible.

## Follow-Up

- Revisit secret configuration before any production deployment.
