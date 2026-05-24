# Task T4: Authentication

## Context

You are continuing work on a Bookmark Manager API that has working bookmark CRUD and folder support. Read `PRODUCT_SPEC.md` for the full specification.

**This is a high-risk task** — it changes the API contract for all existing endpoints and introduces security-critical code.

## Task

Add user authentication so bookmarks and folders are owned by users:

1. Create the `users` table: `id` (integer primary key), `email` (text, unique, required), `password_hash` (text, required), `created_at` (text)
2. Implement auth endpoints:
   - `POST /auth/register` — Create account. Requires `email` + `password`. Returns 201 + user (without password_hash). Return 409 if email exists.
   - `POST /auth/login` — Authenticate. Returns 200 + `{ "token": "<jwt>" }`. Return 401 if credentials are wrong.
3. Add authentication middleware:
   - All `/bookmarks` and `/folders` endpoints now require `Authorization: Bearer <token>` header
   - Return 401 if token is missing or invalid
4. Scope data to the authenticated user:
   - Add `user_id` column to `bookmarks` and `folders` tables
   - Users can only see/modify their own bookmarks and folders
5. Validation:
   - Email must be valid format
   - Password must be >= 8 characters
   - Return 400 for invalid input

## Acceptance Criteria

- Registration creates a user with hashed password
- Login returns a valid JWT token
- Protected endpoints return 401 without valid token
- Each user only sees their own bookmarks/folders
- Previous bookmark/folder functionality works (with auth)
- Cannot register duplicate email (409)
- Invalid credentials → 401

## Notes

- Use `bcryptjs` for password hashing (in dependencies)
- Use `jsonwebtoken` for JWT (in dependencies)
- JWT secret can be a hardcoded string for this project (e.g., `"benchmark-secret"`)
- JWT should include `userId` in payload
- This task requires careful planning — it modifies existing endpoints
- Consider: what happens to existing data? (For this benchmark, fresh DB each run is fine)
