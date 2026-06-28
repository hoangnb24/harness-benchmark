# Product Specification: Bookmark Manager API

## Overview

A REST API for managing bookmarks with folder organization, user authentication, and pagination. Built with TypeScript, Express, and better-sqlite3.

## Functional Requirements

### Core Entities

- **Bookmark**: A saved URL with title, optional description, tags, timestamps
- **Folder**: A named collection of bookmarks
- **Tag**: A user-owned label that can be attached to many bookmarks
- **User**: An authenticated account that owns bookmarks and folders

### API Endpoints

#### Health
- `GET /health` → `{ "status": "ok" }`

#### Bookmarks (after auth: scoped to authenticated user)
- `POST /bookmarks` — Create a bookmark (requires: url, title)
- `GET /bookmarks` — List all bookmarks (paginated after T6; filterable by tag after T7)
- `GET /bookmarks/:id` — Get single bookmark
- `PUT /bookmarks/:id` — Update a bookmark
- `DELETE /bookmarks/:id` — Delete a bookmark

#### Tags
- `POST /tags` — Create a tag (requires: name)
- `GET /tags` — List all tags
- `PUT /tags/:id` — Rename a tag
- `DELETE /tags/:id` — Delete a tag and unlink it from bookmarks

#### Folders
- `POST /folders` — Create a folder (requires: name)
- `GET /folders` — List all folders
- `GET /folders/:id` — Get folder with its bookmarks
- `PUT /folders/:id` — Update folder name
- `DELETE /folders/:id` — Delete folder (bookmarks become unfoldered)

#### Authentication
- `POST /auth/register` — Create account (email + password)
- `POST /auth/login` — Get JWT token
- All bookmark/folder endpoints require `Authorization: Bearer <token>` after auth is implemented

### Validation Rules

- Bookmark `url` must be a valid URL
- Bookmark `title` must be non-empty string
- Folder `name` must be non-empty string
- Tag `name` must be non-empty string and unique per authenticated user
- Bookmark `tag_ids` must reference existing tags owned by the authenticated user
- Email must be valid format
- Password must be >= 8 characters

### Pagination (after T6)

- `GET /bookmarks?page=1&limit=20`
- `GET /bookmarks?tag=work`
- `GET /bookmarks?tags=work,docs`
- Response shape: `{ data: [...], page: 1, limit: 20, total: 45 }`
- Default: page=1, limit=20
- Max limit: 100

## Technical Stack (Pre-decided)

- **Runtime**: Node.js 20+
- **Language**: TypeScript
- **Framework**: Express
- **Database**: SQLite via better-sqlite3
- **Testing**: Vitest
- **Port**: 3000

## Non-Functional Requirements

- All responses are JSON
- Proper HTTP status codes (200, 201, 204, 400, 401, 404, 500)
- Passwords stored as hashes (bcrypt or similar)
- JWT tokens for session management
- Database file: `data.db` (application data)
