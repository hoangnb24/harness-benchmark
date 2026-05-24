# Task T5: Bug Fix

## Context

You are continuing work on a Bookmark Manager API with full CRUD, folders, and authentication. Read `PRODUCT_SPEC.md` for the full specification.

## Bug Report

**Title**: Server returns 500 instead of 400 when creating a bookmark with an empty title

**Steps to reproduce**:
1. Login to get a valid token
2. `POST /bookmarks` with body `{"url": "https://example.com", "title": ""}`
3. Expected: 400 Bad Request with error message
4. Actual: 500 Internal Server Error (likely database constraint violation bubbling up)

**Additional observations**:
- Same issue may exist for empty `url` field
- Same issue may exist for folder `name` field
- The validation should catch empty strings BEFORE attempting database insertion

## Task

1. Diagnose the root cause of the 500 error
2. Fix the validation to properly reject empty strings (not just missing fields)
3. Ensure consistent validation across all creation/update endpoints:
   - `POST /bookmarks`: `title` and `url` must be non-empty strings
   - `PUT /bookmarks/:id`: if `title` or `url` is provided, must be non-empty
   - `POST /folders`: `name` must be non-empty string
   - `PUT /folders/:id`: if `name` is provided, must be non-empty
4. Return appropriate 400 responses with descriptive error messages

## Acceptance Criteria

- `POST /bookmarks` with `{"url": "https://example.com", "title": ""}` → 400 (not 500)
- `POST /bookmarks` with `{"url": "", "title": "Test"}` → 400
- `POST /folders` with `{"name": ""}` → 400
- All previous functionality still works
- Error responses include a `message` or `error` field explaining what's wrong
- No 500 errors for validation issues

## Notes

- This is a targeted fix — don't refactor unrelated code
- The bug likely exists because validation checks for `undefined`/`null` but not empty string `""`
- Add validation for whitespace-only strings too (e.g., `"   "` should be rejected)
