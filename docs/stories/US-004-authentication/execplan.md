# US-004 Authentication Exec Plan

## Goal

Add JWT authentication and user-scoped bookmarks/folders while preserving the
existing CRUD and folder workflows behind authentication.

## Scope

In scope:

- `users` table with unique email and hashed password.
- `POST /auth/register` and `POST /auth/login`.
- Bearer-token middleware for `/bookmarks` and `/folders`.
- `user_id` ownership columns and SQL scoping for bookmarks and folders.
- Integration tests for auth, duplicate registration, invalid credentials, and
  cross-user isolation.

Out of scope:

- Production-grade secret management.
- Refresh token rotation.
- Existing data migration beyond tolerant local schema evolution.

## Risk Classification

Risk flags:

- Auth.
- Authorization.
- Data model.
- Public contracts.
- Existing behavior.
- Weak proof until auth isolation tests pass.

Hard gates:

- Auth.
- Authorization.
- Audit/security.

## Work Phases

1. Discovery: read current routes, schema, tests, and product contract.
2. Design: add user-owned data model and middleware boundary.
3. Validation planning: extend existing integration tests for auth and isolation.
4. Implementation: add auth module, schema updates, route scoping, and tests.
5. Verification: run focused Vitest tests and TypeScript build.
6. Harness update: record story, decision, and proof.

## Stop Conditions

Pause for human confirmation if:

- Existing data must be preserved across auth migration.
- Token/session behavior needs production-grade secret rotation.
- Validation requirements need to be weakened.
