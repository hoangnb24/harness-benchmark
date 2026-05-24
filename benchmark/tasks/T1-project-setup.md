# Task T1: Project Setup

## Context

You are working in a TypeScript/Express project that will become a Bookmark Manager API. The project has `package.json`, `tsconfig.json`, and a minimal `src/index.ts` already in place. Read `PRODUCT_SPEC.md` for the full product specification.

## Task

Set up the project so it runs correctly:

1. Install dependencies (`npm install`)
2. Set up the Express server in `src/index.ts` to listen on port 3000
3. Add a health check endpoint: `GET /health` that returns `{ "status": "ok" }` with status 200
4. Verify the server starts without errors (`npm run dev`)
5. Set up the SQLite database file (`data.db`) with an initial connection

## Acceptance Criteria

- `npm install` succeeds without errors
- `npm run dev` starts the server on port 3000
- `GET http://localhost:3000/health` returns `{"status":"ok"}` with HTTP 200
- A SQLite database file can be created/connected

## Notes

- Use the dependencies already specified in `package.json`
- The project uses `tsx` for development (already configured in scripts)
- Keep the code clean and well-structured
