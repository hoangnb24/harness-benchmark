# US-004 Authentication Design

## Domain Model

User accounts are identified by integer `id`, unique normalized email, and a
bcrypt password hash. Bookmarks and folders each carry a `user_id` owner.

## Application Flow

Registration validates email and password, rejects duplicate email, hashes the
password, and returns the public user record. Login validates credentials and
returns a JWT with `userId` in the payload. Protected route handlers read the
authenticated user id from middleware and include it in all ownership-sensitive
SQL.

## Interface Contract

- `POST /auth/register` accepts `{ "email": string, "password": string }` and
  returns `201` plus `{ id, email, created_at }`.
- `POST /auth/register` returns `400` for invalid email/password and `409` for
  duplicate email.
- `POST /auth/login` accepts `{ "email": string, "password": string }` and
  returns `200` plus `{ "token": string }`.
- `POST /auth/login` returns `401` for invalid credentials.
- `/bookmarks` and `/folders` require `Authorization: Bearer <token>` and return
  `401` for missing or invalid tokens.
- Bookmark and folder `404` behavior applies within the authenticated user's
  data only.

## Data Model

SQLite `users` has `id`, `email`, `password_hash`, and `created_at`. `bookmarks`
and `folders` have `user_id` ownership columns. Existing local databases are
altered tolerantly; benchmark runs use a fresh database.

## UI / Platform Impact

No browser, mobile, desktop, or CLI UI surface changes.

## Observability

No application log or audit-log contract exists in this benchmark slice.

## Alternatives Considered

1. Session cookies: rejected because the product spec requires JWT tokens.
2. Global folders with user-scoped bookmarks: rejected because folders are also
   user-owned entities in the task.
