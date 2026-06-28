import { afterAll, beforeAll, expect, test } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Server } from "node:http";
import type { Express } from "express";
import type Database from "better-sqlite3";

process.env.NODE_ENV = "test";
const tempDir = mkdtempSync(join(tmpdir(), "bookmark-api-"));
process.env.DATABASE_PATH = join(tempDir, "data.db");

let app: Express;
let db: Database.Database;
let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const appModule = await import("./index");
  app = appModule.default;
  db = appModule.db;

  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      const address = server.address();
      if (address && typeof address === "object") {
        baseUrl = `http://127.0.0.1:${address.port}`;
      }
      resolve();
    });
  });
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });

  db.close();
  rmSync(tempDir, { recursive: true, force: true });
});

async function request(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...init?.headers,
    },
  });
}

function authHeaders(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

async function registerUser(email: string, password = "password123"): Promise<{ id: number; email: string; token: string }> {
  const registerResponse = await request("/auth/register", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
  const user = (await registerResponse.json()) as { id: number; email: string; password_hash?: string };

  expect(registerResponse.status).toBe(201);
  expect(user).toMatchObject({ id: expect.any(Number), email });
  expect(user.password_hash).toBeUndefined();

  const loginResponse = await request("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
  const login = (await loginResponse.json()) as { token: string };

  expect(loginResponse.status).toBe(200);
  expect(login.token).toEqual(expect.any(String));

  return { ...user, token: login.token };
}

async function createBookmark(
  token: string,
  values: { url: string; title: string; description?: string; folder_id?: number; tag_ids?: number[] },
): Promise<{ id: number; title: string; folder_id: number | null; version: number; tags: Array<{ id: number; name: string }> }> {
  const response = await request("/bookmarks", {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify(values),
  });
  const bookmark = (await response.json()) as {
    id: number;
    title: string;
    folder_id: number | null;
    version: number;
    tags: Array<{ id: number; name: string }>;
  };

  expect(response.status).toBe(201);
  return bookmark;
}

async function createTag(token: string, name: string): Promise<{ id: number; name: string }> {
  const response = await request("/tags", {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({ name }),
  });
  const tag = (await response.json()) as { id: number; name: string };

  expect(response.status).toBe(201);
  return tag;
}

async function createFolder(token: string, name: string): Promise<{ id: number; name: string }> {
  const response = await request("/folders", {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({ name }),
  });
  const folder = (await response.json()) as { id: number; name: string };

  expect(response.status).toBe(201);
  return folder;
}

test("GET /health returns ok", async () => {
  const response = await request("/health");

  await expect(response.json()).resolves.toEqual({ status: "ok" });
  expect(response.status).toBe(200);
});

test("auth registration hashes passwords and rejects invalid or duplicate credentials", async () => {
  const invalidEmail = await request("/auth/register", {
    method: "POST",
    body: JSON.stringify({ email: "invalid", password: "password123" }),
  });
  expect(invalidEmail.status).toBe(400);

  const shortPassword = await request("/auth/register", {
    method: "POST",
    body: JSON.stringify({ email: "short@example.com", password: "short" }),
  });
  expect(shortPassword.status).toBe(400);

  const user = await registerUser("auth-register@example.com");
  const persisted = db.prepare("SELECT password_hash FROM users WHERE id = ?").get(user.id) as { password_hash: string };
  expect(persisted.password_hash).not.toBe("password123");
  expect(persisted.password_hash).toEqual(expect.any(String));

  const duplicate = await request("/auth/register", {
    method: "POST",
    body: JSON.stringify({ email: "auth-register@example.com", password: "password123" }),
  });
  expect(duplicate.status).toBe(409);
});

test("auth login rejects invalid credentials", async () => {
  await registerUser("auth-login@example.com", "correct-password");

  const wrongPassword = await request("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: "auth-login@example.com", password: "wrong-password" }),
  });
  expect(wrongPassword.status).toBe(401);

  const missingUser = await request("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: "missing@example.com", password: "wrong-password" }),
  });
  expect(missingUser.status).toBe(401);
});

test("bookmark and folder endpoints require a valid bearer token", async () => {
  const noToken = await request("/bookmarks");
  expect(noToken.status).toBe(401);

  const badToken = await request("/folders", {
    headers: authHeaders("not-a-real-token"),
  });
  expect(badToken.status).toBe(401);
});

test("bookmarks CRUD flow persists records in SQLite", async () => {
  const user = await registerUser("bookmarks-crud@example.com");
  const createResponse = await request("/bookmarks", {
    method: "POST",
    headers: authHeaders(user.token),
    body: JSON.stringify({
      url: "https://example.com",
      title: "Example",
      description: "Reference site",
    }),
  });
  const created = (await createResponse.json()) as { id: number; title: string; description: string; version: number };

  expect(createResponse.status).toBe(201);
  expect(created).toMatchObject({
    id: expect.any(Number),
    user_id: user.id,
    url: "https://example.com",
    title: "Example",
    description: "Reference site",
    version: 1,
    created_at: expect.any(String),
    updated_at: expect.any(String),
    folder_id: null,
  });

  const persisted = db.prepare("SELECT COUNT(*) AS count FROM bookmarks WHERE id = ?").get(created.id) as { count: number };
  expect(persisted.count).toBe(1);

  const listResponse = await request("/bookmarks");
  const authorizedListResponse = await request("/bookmarks", {
    headers: authHeaders(user.token),
  });
  expect(listResponse.status).toBe(401);
  await expect(authorizedListResponse.json()).resolves.toEqual({
    data: [expect.objectContaining({ id: created.id })],
    page: 1,
    limit: 20,
    total: 1,
  });
  expect(authorizedListResponse.status).toBe(200);

  const getResponse = await request(`/bookmarks/${created.id}`, {
    headers: authHeaders(user.token),
  });
  await expect(getResponse.json()).resolves.toEqual(expect.objectContaining({ id: created.id, title: "Example" }));
  expect(getResponse.status).toBe(200);

  const updateResponse = await request(`/bookmarks/${created.id}`, {
    method: "PUT",
    headers: authHeaders(user.token),
    body: JSON.stringify({ title: "Updated Example", description: null, version: created.version }),
  });
  await expect(updateResponse.json()).resolves.toEqual(
    expect.objectContaining({ id: created.id, title: "Updated Example", description: null, version: 2 }),
  );
  expect(updateResponse.status).toBe(200);

  const deleteResponse = await request(`/bookmarks/${created.id}`, { method: "DELETE", headers: authHeaders(user.token) });
  expect(deleteResponse.status).toBe(204);

  const missingResponse = await request(`/bookmarks/${created.id}`, {
    headers: authHeaders(user.token),
  });
  expect(missingResponse.status).toBe(404);
});

test("folders CRUD flow includes bookmarks and unfolders on delete", async () => {
  const user = await registerUser("folders-crud@example.com");
  const createFolderResponse = await request("/folders", {
    method: "POST",
    headers: authHeaders(user.token),
    body: JSON.stringify({ name: "Reading List" }),
  });
  const createdFolder = (await createFolderResponse.json()) as { id: number; name: string };

  expect(createFolderResponse.status).toBe(201);
  expect(createdFolder).toMatchObject({
    id: expect.any(Number),
    user_id: user.id,
    name: "Reading List",
    created_at: expect.any(String),
    updated_at: expect.any(String),
  });

  const listFoldersResponse = await request("/folders", {
    headers: authHeaders(user.token),
  });
  await expect(listFoldersResponse.json()).resolves.toEqual([expect.objectContaining({ id: createdFolder.id })]);
  expect(listFoldersResponse.status).toBe(200);

  const createBookmarkResponse = await request("/bookmarks", {
    method: "POST",
    headers: authHeaders(user.token),
    body: JSON.stringify({
      url: "https://example.com/foldered",
      title: "Foldered bookmark",
      folder_id: createdFolder.id,
    }),
  });
  const createdBookmark = (await createBookmarkResponse.json()) as { id: number; folder_id: number | null; version: number };

  expect(createBookmarkResponse.status).toBe(201);
  expect(createdBookmark).toMatchObject({
    id: expect.any(Number),
    folder_id: createdFolder.id,
  });

  const getFolderResponse = await request(`/folders/${createdFolder.id}`, {
    headers: authHeaders(user.token),
  });
  await expect(getFolderResponse.json()).resolves.toEqual(
    expect.objectContaining({
      id: createdFolder.id,
      name: "Reading List",
      bookmarks: [expect.objectContaining({ id: createdBookmark.id, folder_id: createdFolder.id })],
    }),
  );
  expect(getFolderResponse.status).toBe(200);

  const updateFolderResponse = await request(`/folders/${createdFolder.id}`, {
    method: "PUT",
    headers: authHeaders(user.token),
    body: JSON.stringify({ name: "Updated Reading List" }),
  });
  await expect(updateFolderResponse.json()).resolves.toEqual(
    expect.objectContaining({ id: createdFolder.id, name: "Updated Reading List" }),
  );
  expect(updateFolderResponse.status).toBe(200);

  const unfolderedBookmarkResponse = await request(`/bookmarks/${createdBookmark.id}`, {
    method: "PUT",
    headers: authHeaders(user.token),
    body: JSON.stringify({ folder_id: null, version: createdBookmark.version }),
  });
  const unfolderedBookmark = (await unfolderedBookmarkResponse.json()) as { id: number; folder_id: null; version: number };
  expect(unfolderedBookmark).toEqual(expect.objectContaining({ id: createdBookmark.id, folder_id: null, version: 2 }));
  expect(unfolderedBookmarkResponse.status).toBe(200);

  const refolderedBookmarkResponse = await request(`/bookmarks/${createdBookmark.id}`, {
    method: "PUT",
    headers: authHeaders(user.token),
    body: JSON.stringify({ folder_id: createdFolder.id, version: unfolderedBookmark.version }),
  });
  expect(refolderedBookmarkResponse.status).toBe(200);

  const deleteFolderResponse = await request(`/folders/${createdFolder.id}`, { method: "DELETE", headers: authHeaders(user.token) });
  expect(deleteFolderResponse.status).toBe(204);

  const bookmarkAfterFolderDeleteResponse = await request(`/bookmarks/${createdBookmark.id}`, {
    headers: authHeaders(user.token),
  });
  await expect(bookmarkAfterFolderDeleteResponse.json()).resolves.toEqual(
    expect.objectContaining({ id: createdBookmark.id, folder_id: null, version: 4 }),
  );
  expect(bookmarkAfterFolderDeleteResponse.status).toBe(200);

  const missingFolderResponse = await request(`/folders/${createdFolder.id}`, {
    headers: authHeaders(user.token),
  });
  expect(missingFolderResponse.status).toBe(404);
});

test("folder endpoints validate required fields and missing records", async () => {
  const user = await registerUser("folder-validation@example.com");
  const missingName = await request("/folders", {
    method: "POST",
    headers: authHeaders(user.token),
    body: JSON.stringify({}),
  });
  expect(missingName.status).toBe(400);

  const emptyName = await request("/folders", {
    method: "POST",
    headers: authHeaders(user.token),
    body: JSON.stringify({ name: "   " }),
  });
  await expect(emptyName.json()).resolves.toHaveProperty("error");
  expect(emptyName.status).toBe(400);

  const blankName = await request("/folders", {
    method: "POST",
    headers: authHeaders(user.token),
    body: JSON.stringify({ name: "" }),
  });
  await expect(blankName.json()).resolves.toHaveProperty("error");
  expect(blankName.status).toBe(400);

  const createdFolderResponse = await request("/folders", {
    method: "POST",
    headers: authHeaders(user.token),
    body: JSON.stringify({ name: "Valid folder" }),
  });
  const createdFolder = (await createdFolderResponse.json()) as { id: number; name: string };
  expect(createdFolderResponse.status).toBe(201);

  const emptyUpdateName = await request(`/folders/${createdFolder.id}`, {
    method: "PUT",
    headers: authHeaders(user.token),
    body: JSON.stringify({ name: "" }),
  });
  await expect(emptyUpdateName.json()).resolves.toHaveProperty("error");
  expect(emptyUpdateName.status).toBe(400);

  const whitespaceUpdateName = await request(`/folders/${createdFolder.id}`, {
    method: "PUT",
    headers: authHeaders(user.token),
    body: JSON.stringify({ name: "   " }),
  });
  await expect(whitespaceUpdateName.json()).resolves.toHaveProperty("error");
  expect(whitespaceUpdateName.status).toBe(400);

  const omittedUpdateName = await request(`/folders/${createdFolder.id}`, {
    method: "PUT",
    headers: authHeaders(user.token),
    body: JSON.stringify({}),
  });
  await expect(omittedUpdateName.json()).resolves.toEqual(expect.objectContaining({ id: createdFolder.id, name: "Valid folder" }));
  expect(omittedUpdateName.status).toBe(200);

  const getMissing = await request("/folders/9999", {
    headers: authHeaders(user.token),
  });
  expect(getMissing.status).toBe(404);

  const updateMissing = await request("/folders/9999", {
    method: "PUT",
    headers: authHeaders(user.token),
    body: JSON.stringify({ name: "Missing" }),
  });
  expect(updateMissing.status).toBe(404);

  const deleteMissing = await request("/folders/9999", { method: "DELETE", headers: authHeaders(user.token) });
  expect(deleteMissing.status).toBe(404);
});

test("bookmarks validate folder_id references an existing folder", async () => {
  const user = await registerUser("folder-reference@example.com");
  const createWithMissingFolder = await request("/bookmarks", {
    method: "POST",
    headers: authHeaders(user.token),
    body: JSON.stringify({
      url: "https://example.com/missing-folder",
      title: "Missing folder",
      folder_id: 9999,
    }),
  });
  expect(createWithMissingFolder.status).toBe(400);

  const createFolderResponse = await request("/folders", {
    method: "POST",
    headers: authHeaders(user.token),
    body: JSON.stringify({ name: "Valid Folder" }),
  });
  const createdFolder = (await createFolderResponse.json()) as { id: number };

  const createBookmarkResponse = await request("/bookmarks", {
    method: "POST",
    headers: authHeaders(user.token),
    body: JSON.stringify({
      url: "https://example.com/valid-folder",
      title: "Valid folder",
      folder_id: createdFolder.id,
    }),
  });
  const createdBookmark = (await createBookmarkResponse.json()) as { id: number; version: number };

  expect(createBookmarkResponse.status).toBe(201);

  const updateWithMissingFolder = await request(`/bookmarks/${createdBookmark.id}`, {
    method: "PUT",
    headers: authHeaders(user.token),
    body: JSON.stringify({ folder_id: 9999, version: createdBookmark.version }),
  });
  expect(updateWithMissingFolder.status).toBe(400);
});

test("tags CRUD flow is scoped to the authenticated user", async () => {
  const user = await registerUser("tags-crud@example.com");
  const otherUser = await registerUser("tags-crud-other@example.com");
  const created = await createTag(user.token, "work");

  expect(created).toMatchObject({
    id: expect.any(Number),
    name: "work",
  });

  const duplicate = await request("/tags", {
    method: "POST",
    headers: authHeaders(user.token),
    body: JSON.stringify({ name: "work" }),
  });
  expect(duplicate.status).toBe(409);

  const otherUserSameName = await request("/tags", {
    method: "POST",
    headers: authHeaders(otherUser.token),
    body: JSON.stringify({ name: "work" }),
  });
  expect(otherUserSameName.status).toBe(201);

  const emptyName = await request("/tags", {
    method: "POST",
    headers: authHeaders(user.token),
    body: JSON.stringify({ name: "   " }),
  });
  await expect(emptyName.json()).resolves.toHaveProperty("error");
  expect(emptyName.status).toBe(400);

  const listResponse = await request("/tags", {
    headers: authHeaders(user.token),
  });
  await expect(listResponse.json()).resolves.toEqual([expect.objectContaining({ id: created.id, name: "work" })]);
  expect(listResponse.status).toBe(200);

  const otherCannotRename = await request(`/tags/${created.id}`, {
    method: "PUT",
    headers: authHeaders(otherUser.token),
    body: JSON.stringify({ name: "taken" }),
  });
  expect(otherCannotRename.status).toBe(404);

  const updateResponse = await request(`/tags/${created.id}`, {
    method: "PUT",
    headers: authHeaders(user.token),
    body: JSON.stringify({ name: "docs" }),
  });
  await expect(updateResponse.json()).resolves.toEqual(expect.objectContaining({ id: created.id, name: "docs" }));
  expect(updateResponse.status).toBe(200);

  const deleteResponse = await request(`/tags/${created.id}`, {
    method: "DELETE",
    headers: authHeaders(user.token),
  });
  expect(deleteResponse.status).toBe(204);

  const missingResponse = await request(`/tags/${created.id}`, {
    headers: authHeaders(user.token),
  });
  expect(missingResponse.status).toBe(404);
});

test("bookmarks accept tag_ids and reject invalid or cross-user tags", async () => {
  const user = await registerUser("bookmark-tags@example.com");
  const otherUser = await registerUser("bookmark-tags-other@example.com");
  const work = await createTag(user.token, "work");
  const docs = await createTag(user.token, "docs");
  const otherTag = await createTag(otherUser.token, "private");

  const created = await createBookmark(user.token, {
    url: "https://example.com/tagged",
    title: "Tagged",
    tag_ids: [work.id, docs.id],
  });
  expect(created.tags).toEqual([
    expect.objectContaining({ id: work.id, name: "work" }),
    expect.objectContaining({ id: docs.id, name: "docs" }),
  ]);

  const createWithCrossUserTag = await request("/bookmarks", {
    method: "POST",
    headers: authHeaders(user.token),
    body: JSON.stringify({
      url: "https://example.com/cross-user-tag",
      title: "Cross user tag",
      tag_ids: [otherTag.id],
    }),
  });
  expect(createWithCrossUserTag.status).toBe(400);

  const createWithInvalidTag = await request("/bookmarks", {
    method: "POST",
    headers: authHeaders(user.token),
    body: JSON.stringify({
      url: "https://example.com/invalid-tag",
      title: "Invalid tag",
      tag_ids: ["not-a-number"],
    }),
  });
  expect(createWithInvalidTag.status).toBe(400);

  const updated = await request(`/bookmarks/${created.id}`, {
    method: "PUT",
    headers: authHeaders(user.token),
    body: JSON.stringify({ tag_ids: [docs.id], version: created.version }),
  });
  const updatedBookmark = (await updated.json()) as { id: number; version: number; tags: Array<{ id: number; name: string }> };
  expect(updatedBookmark).toEqual(
    expect.objectContaining({
      id: created.id,
      version: 2,
      tags: [expect.objectContaining({ id: docs.id, name: "docs" })],
    }),
  );
  expect(updated.status).toBe(200);

  const updateWithCrossUserTag = await request(`/bookmarks/${created.id}`, {
    method: "PUT",
    headers: authHeaders(user.token),
    body: JSON.stringify({ tag_ids: [otherTag.id], version: updatedBookmark.version }),
  });
  expect(updateWithCrossUserTag.status).toBe(400);
});

test("deleting a tag unlinks it from bookmarks without deleting bookmarks", async () => {
  const user = await registerUser("tag-delete@example.com");
  const work = await createTag(user.token, "work");
  const created = await createBookmark(user.token, {
    url: "https://example.com/tag-delete",
    title: "Tagged bookmark",
    tag_ids: [work.id],
  });

  const deleteResponse = await request(`/tags/${work.id}`, {
    method: "DELETE",
    headers: authHeaders(user.token),
  });
  expect(deleteResponse.status).toBe(204);

  const bookmarkResponse = await request(`/bookmarks/${created.id}`, {
    headers: authHeaders(user.token),
  });
  await expect(bookmarkResponse.json()).resolves.toEqual(expect.objectContaining({ id: created.id, tags: [] }));
  expect(bookmarkResponse.status).toBe(200);
});

test("PUT /bookmarks uses optimistic concurrency control", async () => {
  const user = await registerUser("bookmark-version@example.com");
  const created = await createBookmark(user.token, {
    url: "https://example.com/versioned",
    title: "Versioned",
  });

  expect(created.version).toBe(1);

  const missingVersion = await request(`/bookmarks/${created.id}`, {
    method: "PUT",
    headers: authHeaders(user.token),
    body: JSON.stringify({ title: "Missing version" }),
  });
  await expect(missingVersion.json()).resolves.toHaveProperty("error");
  expect(missingVersion.status).toBe(400);

  const firstUpdate = await request(`/bookmarks/${created.id}`, {
    method: "PUT",
    headers: authHeaders(user.token),
    body: JSON.stringify({ title: "Fresh update", version: created.version }),
  });
  const updated = (await firstUpdate.json()) as { id: number; title: string; version: number };

  expect(firstUpdate.status).toBe(200);
  expect(updated).toEqual(expect.objectContaining({ id: created.id, title: "Fresh update", version: 2 }));

  const staleUpdate = await request(`/bookmarks/${created.id}`, {
    method: "PUT",
    headers: authHeaders(user.token),
    body: JSON.stringify({ title: "Stale update", version: created.version }),
  });
  const conflict = (await staleUpdate.json()) as { id: number; title: string; version: number };

  expect(staleUpdate.status).toBe(409);
  expect(conflict).toEqual(expect.objectContaining({ id: created.id, title: "Fresh update", version: 2 }));
});

test("GET /bookmarks filters by one or multiple tag names", async () => {
  const user = await registerUser("tag-filter@example.com");
  const otherUser = await registerUser("tag-filter-other@example.com");
  const work = await createTag(user.token, "work");
  const docs = await createTag(user.token, "docs");
  const personal = await createTag(user.token, "personal");
  const otherWork = await createTag(otherUser.token, "work");

  const workBookmark = await createBookmark(user.token, {
    url: "https://example.com/work",
    title: "Work",
    tag_ids: [work.id],
  });
  const docsBookmark = await createBookmark(user.token, {
    url: "https://example.com/docs",
    title: "Docs",
    tag_ids: [docs.id],
  });
  await createBookmark(user.token, {
    url: "https://example.com/personal",
    title: "Personal",
    tag_ids: [personal.id],
  });
  await createBookmark(otherUser.token, {
    url: "https://example.com/other-work",
    title: "Other Work",
    tag_ids: [otherWork.id],
  });

  const oneTagResponse = await request("/bookmarks?tag=work", {
    headers: authHeaders(user.token),
  });
  await expect(oneTagResponse.json()).resolves.toEqual({
    data: [expect.objectContaining({ id: workBookmark.id, tags: [expect.objectContaining({ name: "work" })] })],
    page: 1,
    limit: 20,
    total: 1,
  });
  expect(oneTagResponse.status).toBe(200);

  const multipleTagsResponse = await request("/bookmarks?tags=work,docs", {
    headers: authHeaders(user.token),
  });
  await expect(multipleTagsResponse.json()).resolves.toEqual({
    data: [expect.objectContaining({ id: workBookmark.id }), expect.objectContaining({ id: docsBookmark.id })],
    page: 1,
    limit: 20,
    total: 2,
  });
  expect(multipleTagsResponse.status).toBe(200);
});

test("GET /bookmarks searches bookmark fields with deterministic ranking", async () => {
  const user = await registerUser("bookmark-search@example.com");
  const otherUser = await registerUser("bookmark-search-other@example.com");
  const docsTag = await createTag(user.token, "docs-tag");
  const otherDocsTag = await createTag(otherUser.token, "docs-tag");
  const docsFolder = await createFolder(user.token, "Docs Folder");
  const otherDocsFolder = await createFolder(otherUser.token, "Docs Folder");

  const exact = await createBookmark(user.token, {
    url: "https://example.com/exact",
    title: "Docs",
  });
  const prefix = await createBookmark(user.token, {
    url: "https://example.com/prefix",
    title: "Docs Portal",
  });
  const substring = await createBookmark(user.token, {
    url: "https://example.com/substring",
    title: "API Docs Reference",
  });
  const urlMatch = await createBookmark(user.token, {
    url: "https://docs.example.com/url",
    title: "URL match",
  });
  const descriptionMatch = await createBookmark(user.token, {
    url: "https://example.com/description",
    title: "Description match",
    description: "Internal docs live here",
  });
  const tagMatch = await createBookmark(user.token, {
    url: "https://example.com/tag",
    title: "Tag match",
    tag_ids: [docsTag.id],
  });
  const folderMatch = await createBookmark(user.token, {
    url: "https://example.com/folder",
    title: "Folder match",
    folder_id: docsFolder.id,
  });
  await createBookmark(user.token, {
    url: "https://example.com/no-match",
    title: "No match",
  });
  await createBookmark(otherUser.token, {
    url: "https://docs.example.com/private",
    title: "Docs",
    folder_id: otherDocsFolder.id,
    tag_ids: [otherDocsTag.id],
  });

  const response = await request("/bookmarks?q=docs", {
    headers: authHeaders(user.token),
  });
  const body = (await response.json()) as { data: Array<{ id: number }>; page: number; limit: number; total: number };

  expect(response.status).toBe(200);
  expect(body).toMatchObject({ page: 1, limit: 20, total: 7 });
  expect(body.data.map((bookmark) => bookmark.id)).toEqual([
    exact.id,
    prefix.id,
    substring.id,
    urlMatch.id,
    descriptionMatch.id,
    tagMatch.id,
    folderMatch.id,
  ]);
});

test("GET /bookmarks search combines with tag filters and pagination", async () => {
  const user = await registerUser("bookmark-search-combined@example.com");
  const docs = await createTag(user.token, "docs");
  const work = await createTag(user.token, "work");

  const first = await createBookmark(user.token, {
    url: "https://example.com/docs-one",
    title: "Docs One",
    tag_ids: [docs.id],
  });
  const second = await createBookmark(user.token, {
    url: "https://example.com/docs-two",
    title: "Docs Two",
    tag_ids: [docs.id],
  });
  await createBookmark(user.token, {
    url: "https://example.com/docs-work",
    title: "Docs Work",
    tag_ids: [work.id],
  });

  const firstPage = await request("/bookmarks?q=docs&tag=docs&page=1&limit=1", {
    headers: authHeaders(user.token),
  });
  await expect(firstPage.json()).resolves.toEqual({
    data: [expect.objectContaining({ id: first.id })],
    page: 1,
    limit: 1,
    total: 2,
  });
  expect(firstPage.status).toBe(200);

  const secondPage = await request("/bookmarks?q=docs&tag=docs&page=2&limit=1", {
    headers: authHeaders(user.token),
  });
  await expect(secondPage.json()).resolves.toEqual({
    data: [expect.objectContaining({ id: second.id })],
    page: 2,
    limit: 1,
    total: 2,
  });
  expect(secondPage.status).toBe(200);
});

test("GET /bookmarks supports cursor pagination without duplicates", async () => {
  const user = await registerUser("bookmark-cursor@example.com");
  const folder = await createFolder(user.token, "Cursor Folder");
  const tag = await createTag(user.token, "cursor-tag");
  const first = await createBookmark(user.token, {
    url: "https://example.com/cursor-one",
    title: "Cursor One",
    folder_id: folder.id,
    tag_ids: [tag.id],
  });
  const second = await createBookmark(user.token, {
    url: "https://example.com/cursor-two",
    title: "Cursor Two",
  });
  const third = await createBookmark(user.token, {
    url: "https://example.com/cursor-three",
    title: "Cursor Three",
  });

  const firstPage = await request("/bookmarks?cursor=&limit=2", {
    headers: authHeaders(user.token),
  });
  const firstPageBody = (await firstPage.json()) as {
    data: Array<{ id: number; folder_id: number | null; tags: Array<{ id: number; name: string }> }>;
    limit: number;
    nextCursor: string | null;
    hasMore: boolean;
  };

  expect(firstPage.status).toBe(200);
  expect(firstPageBody.limit).toBe(2);
  expect(firstPageBody.hasMore).toBe(true);
  expect(firstPageBody.nextCursor).toEqual(expect.any(String));
  expect(firstPageBody.data.map((bookmark) => bookmark.id)).toEqual([first.id, second.id]);
  expect(firstPageBody.data[0]).toEqual(
    expect.objectContaining({
      folder_id: folder.id,
      tags: [expect.objectContaining({ id: tag.id, name: "cursor-tag" })],
    }),
  );

  const secondPage = await request(`/bookmarks?cursor=${encodeURIComponent(firstPageBody.nextCursor as string)}&limit=2`, {
    headers: authHeaders(user.token),
  });
  const secondPageBody = (await secondPage.json()) as {
    data: Array<{ id: number }>;
    limit: number;
    nextCursor: string | null;
    hasMore: boolean;
  };

  expect(secondPage.status).toBe(200);
  expect(secondPageBody).toMatchObject({ limit: 2, nextCursor: null, hasMore: false });
  expect(secondPageBody.data.map((bookmark) => bookmark.id)).toEqual([third.id]);
});

test("GET /bookmarks rejects invalid cursor tokens", async () => {
  const user = await registerUser("bookmark-invalid-cursor@example.com");

  const response = await request("/bookmarks?cursor=not-a-valid-token&limit=2", {
    headers: authHeaders(user.token),
  });

  await expect(response.json()).resolves.toEqual({ error: "cursor must be a valid cursor token" });
  expect(response.status).toBe(400);
});

test("users can export and idempotently import bookmarks, folders, tags, and associations", async () => {
  const sourceUser = await registerUser("export-source@example.com");
  const targetUser = await registerUser("import-target@example.com");
  const otherUser = await registerUser("import-other@example.com");
  const folder = await createFolder(sourceUser.token, "Reference");
  const docs = await createTag(sourceUser.token, "docs");
  const work = await createTag(sourceUser.token, "work");

  await createBookmark(sourceUser.token, {
    url: "https://example.com/reference",
    title: "Reference",
    description: "Portable bookmark",
    folder_id: folder.id,
    tag_ids: [docs.id, work.id],
  });
  await createBookmark(sourceUser.token, {
    url: "https://example.com/unfiled",
    title: "Unfiled",
    tag_ids: [docs.id],
  });
  await createBookmark(otherUser.token, {
    url: "https://example.com/private",
    title: "Private",
  });

  const exportResponse = await request("/export", {
    headers: authHeaders(sourceUser.token),
  });
  const exported = (await exportResponse.json()) as {
    version: 1;
    folders: Array<{ id: number; name: string }>;
    tags: Array<{ id: number; name: string }>;
    bookmarks: Array<{ id: number; title: string; folder_id: number | null; tag_ids: number[] }>;
  };

  expect(exportResponse.status).toBe(200);
  expect(exported).toMatchObject({
    version: 1,
    folders: [expect.objectContaining({ name: "Reference" })],
    tags: [expect.objectContaining({ name: "docs" }), expect.objectContaining({ name: "work" })],
    bookmarks: [
      expect.objectContaining({ title: "Reference", folder_id: folder.id, tag_ids: [docs.id, work.id] }),
      expect.objectContaining({ title: "Unfiled", folder_id: null, tag_ids: [docs.id] }),
    ],
  });

  const importResponse = await request("/import", {
    method: "POST",
    headers: authHeaders(targetUser.token),
    body: JSON.stringify(exported),
  });
  await expect(importResponse.json()).resolves.toEqual({ imported: 5, skipped: 0, updated: 0 });
  expect(importResponse.status).toBe(200);

  const importedBookmarksResponse = await request("/bookmarks", {
    headers: authHeaders(targetUser.token),
  });
  const importedBookmarks = (await importedBookmarksResponse.json()) as {
    data: Array<{ title: string; folder_id: number | null; tags: Array<{ name: string }> }>;
    total: number;
  };
  expect(importedBookmarksResponse.status).toBe(200);
  expect(importedBookmarks.total).toBe(2);
  expect(importedBookmarks.data).toEqual([
    expect.objectContaining({
      title: "Reference",
      folder_id: expect.any(Number),
      tags: [expect.objectContaining({ name: "docs" }), expect.objectContaining({ name: "work" })],
    }),
    expect.objectContaining({
      title: "Unfiled",
      folder_id: null,
      tags: [expect.objectContaining({ name: "docs" })],
    }),
  ]);

  const secondImportResponse = await request("/import", {
    method: "POST",
    headers: authHeaders(targetUser.token),
    body: JSON.stringify(exported),
  });
  await expect(secondImportResponse.json()).resolves.toEqual({ imported: 0, skipped: 5, updated: 0 });
  expect(secondImportResponse.status).toBe(200);

  const otherExportResponse = await request("/export", {
    headers: authHeaders(otherUser.token),
  });
  const otherExported = (await otherExportResponse.json()) as { bookmarks: Array<{ title: string }> };
  expect(otherExportResponse.status).toBe(200);
  expect(otherExported.bookmarks).toEqual([expect.objectContaining({ title: "Private" })]);
});

test("import dedupes bookmarks by normalized URL per user", async () => {
  const user = await registerUser("import-normalized@example.com");
  await createBookmark(user.token, {
    url: "https://EXAMPLE.com:443/docs#section",
    title: "Existing",
  });

  const payload = {
    version: 1,
    folders: [],
    tags: [],
    bookmarks: [
      {
        id: 1,
        url: "https://example.com/docs",
        title: "Imported",
        description: null,
        folder_id: null,
        tag_ids: [],
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
      },
    ],
  };

  const firstImport = await request("/import", {
    method: "POST",
    headers: authHeaders(user.token),
    body: JSON.stringify(payload),
  });
  await expect(firstImport.json()).resolves.toEqual({ imported: 0, skipped: 0, updated: 1 });
  expect(firstImport.status).toBe(200);

  const secondImport = await request("/import", {
    method: "POST",
    headers: authHeaders(user.token),
    body: JSON.stringify(payload),
  });
  await expect(secondImport.json()).resolves.toEqual({ imported: 0, skipped: 1, updated: 0 });
  expect(secondImport.status).toBe(200);

  const listResponse = await request("/bookmarks", {
    headers: authHeaders(user.token),
  });
  await expect(listResponse.json()).resolves.toEqual({
    data: [expect.objectContaining({ title: "Imported", url: "https://example.com/docs" })],
    page: 1,
    limit: 20,
    total: 1,
  });
  expect(listResponse.status).toBe(200);
});

test("import rejects invalid payloads", async () => {
  const user = await registerUser("import-invalid@example.com");
  const invalidEnvelope = await request("/import", {
    method: "POST",
    headers: authHeaders(user.token),
    body: JSON.stringify({ folders: [], tags: [], bookmarks: [] }),
  });
  expect(invalidEnvelope.status).toBe(400);

  const invalidAssociation = await request("/import", {
    method: "POST",
    headers: authHeaders(user.token),
    body: JSON.stringify({
      version: 1,
      folders: [],
      tags: [],
      bookmarks: [
        {
          id: 1,
          url: "https://example.com/broken",
          title: "Broken",
          description: null,
          folder_id: 99,
          tag_ids: [],
          created_at: "2026-01-01T00:00:00.000Z",
          updated_at: "2026-01-01T00:00:00.000Z",
        },
      ],
    }),
  });
  await expect(invalidAssociation.json()).resolves.toHaveProperty("error");
  expect(invalidAssociation.status).toBe(400);
});

test("GET /bookmarks validates q length and treats empty q like no search", async () => {
  const user = await registerUser("bookmark-search-validation@example.com");
  const created = await createBookmark(user.token, {
    url: "https://example.com/search-validation",
    title: "Search validation",
  });

  const emptySearch = await request("/bookmarks?q=%20%20%20", {
    headers: authHeaders(user.token),
  });
  await expect(emptySearch.json()).resolves.toEqual({
    data: [expect.objectContaining({ id: created.id })],
    page: 1,
    limit: 20,
    total: 1,
  });
  expect(emptySearch.status).toBe(200);

  const longQuery = await request(`/bookmarks?q=${"a".repeat(201)}`, {
    headers: authHeaders(user.token),
  });
  await expect(longQuery.json()).resolves.toHaveProperty("error");
  expect(longQuery.status).toBe(400);
});

test("users only see and modify their own bookmarks and folders", async () => {
  const firstUser = await registerUser("first-user@example.com");
  const secondUser = await registerUser("second-user@example.com");

  const firstFolderResponse = await request("/folders", {
    method: "POST",
    headers: authHeaders(firstUser.token),
    body: JSON.stringify({ name: "Private Folder" }),
  });
  const firstFolder = (await firstFolderResponse.json()) as { id: number };

  const firstBookmarkResponse = await request("/bookmarks", {
    method: "POST",
    headers: authHeaders(firstUser.token),
    body: JSON.stringify({
      url: "https://example.com/private",
      title: "Private",
      folder_id: firstFolder.id,
    }),
  });
  const firstBookmark = (await firstBookmarkResponse.json()) as { id: number };

  const secondList = await request("/bookmarks", {
    headers: authHeaders(secondUser.token),
  });
  await expect(secondList.json()).resolves.toEqual({
    data: [],
    page: 1,
    limit: 20,
    total: 0,
  });
  expect(secondList.status).toBe(200);

  const secondCannotReadBookmark = await request(`/bookmarks/${firstBookmark.id}`, {
    headers: authHeaders(secondUser.token),
  });
  expect(secondCannotReadBookmark.status).toBe(404);

  const secondCannotUpdateBookmark = await request(`/bookmarks/${firstBookmark.id}`, {
    method: "PUT",
    headers: authHeaders(secondUser.token),
    body: JSON.stringify({ title: "Taken" }),
  });
  expect(secondCannotUpdateBookmark.status).toBe(404);

  const secondCannotUseFolder = await request("/bookmarks", {
    method: "POST",
    headers: authHeaders(secondUser.token),
    body: JSON.stringify({
      url: "https://example.com/nope",
      title: "Nope",
      folder_id: firstFolder.id,
    }),
  });
  expect(secondCannotUseFolder.status).toBe(400);

  const secondCannotReadFolder = await request(`/folders/${firstFolder.id}`, {
    headers: authHeaders(secondUser.token),
  });
  expect(secondCannotReadFolder.status).toBe(404);
});

test("folder sharing grants read-only access and can be revoked", async () => {
  const owner = await registerUser("share-owner@example.com");
  const sharedUser = await registerUser("share-reader@example.com");
  const outsider = await registerUser("share-outsider@example.com");

  const folder = await createFolder(owner.token, "Shared Reference");
  const tag = await createTag(owner.token, "reference");
  const bookmark = await createBookmark(owner.token, {
    url: "https://example.com/shared-reference",
    title: "Shared Reference Bookmark",
    folder_id: folder.id,
    tag_ids: [tag.id],
  });

  const outsiderCannotShare = await request(`/folders/${folder.id}/share`, {
    method: "POST",
    headers: authHeaders(outsider.token),
    body: JSON.stringify({ email: sharedUser.email }),
  });
  expect(outsiderCannotShare.status).toBe(404);

  const shareResponse = await request(`/folders/${folder.id}/share`, {
    method: "POST",
    headers: authHeaders(owner.token),
    body: JSON.stringify({ email: sharedUser.email.toUpperCase() }),
  });
  await expect(shareResponse.json()).resolves.toEqual({
    folder_id: folder.id,
    user_id: sharedUser.id,
    created_at: expect.any(String),
  });
  expect(shareResponse.status).toBe(201);

  const sharedFoldersResponse = await request("/shared/folders", {
    headers: authHeaders(sharedUser.token),
  });
  await expect(sharedFoldersResponse.json()).resolves.toEqual([
    expect.objectContaining({ id: folder.id, user_id: owner.id, name: "Shared Reference", shared_at: expect.any(String) }),
  ]);
  expect(sharedFoldersResponse.status).toBe(200);

  const sharedFolderResponse = await request(`/folders/${folder.id}`, {
    headers: authHeaders(sharedUser.token),
  });
  await expect(sharedFolderResponse.json()).resolves.toEqual(
    expect.objectContaining({
      id: folder.id,
      user_id: owner.id,
      bookmarks: [
        expect.objectContaining({
          id: bookmark.id,
          title: "Shared Reference Bookmark",
          tags: [expect.objectContaining({ id: tag.id, name: "reference" })],
        }),
      ],
    }),
  );
  expect(sharedFolderResponse.status).toBe(200);

  const sharedBookmarkResponse = await request(`/bookmarks/${bookmark.id}`, {
    headers: authHeaders(sharedUser.token),
  });
  await expect(sharedBookmarkResponse.json()).resolves.toEqual(expect.objectContaining({ id: bookmark.id, folder_id: folder.id }));
  expect(sharedBookmarkResponse.status).toBe(200);

  const outsiderCannotReadFolder = await request(`/folders/${folder.id}`, {
    headers: authHeaders(outsider.token),
  });
  expect(outsiderCannotReadFolder.status).toBe(404);

  const outsiderCannotReadBookmark = await request(`/bookmarks/${bookmark.id}`, {
    headers: authHeaders(outsider.token),
  });
  expect(outsiderCannotReadBookmark.status).toBe(404);

  const sharedCannotCreateBookmark = await request("/bookmarks", {
    method: "POST",
    headers: authHeaders(sharedUser.token),
    body: JSON.stringify({
      url: "https://example.com/shared-write",
      title: "Shared Write",
      folder_id: folder.id,
    }),
  });
  expect(sharedCannotCreateBookmark.status).toBe(403);

  const sharedCannotUpdateBookmark = await request(`/bookmarks/${bookmark.id}`, {
    method: "PUT",
    headers: authHeaders(sharedUser.token),
    body: JSON.stringify({ title: "Changed" }),
  });
  expect(sharedCannotUpdateBookmark.status).toBe(403);

  const readerTag = await createTag(sharedUser.token, "reader-tag");
  const sharedCannotTagBookmark = await request(`/bookmarks/${bookmark.id}`, {
    method: "PUT",
    headers: authHeaders(sharedUser.token),
    body: JSON.stringify({ tag_ids: [readerTag.id] }),
  });
  expect(sharedCannotTagBookmark.status).toBe(403);

  const sharedCannotDeleteBookmark = await request(`/bookmarks/${bookmark.id}`, {
    method: "DELETE",
    headers: authHeaders(sharedUser.token),
  });
  expect(sharedCannotDeleteBookmark.status).toBe(403);

  const sharedCannotUpdateFolder = await request(`/folders/${folder.id}`, {
    method: "PUT",
    headers: authHeaders(sharedUser.token),
    body: JSON.stringify({ name: "Changed" }),
  });
  expect(sharedCannotUpdateFolder.status).toBe(403);

  const ownerStillUpdatesBookmark = await request(`/bookmarks/${bookmark.id}`, {
    method: "PUT",
    headers: authHeaders(owner.token),
    body: JSON.stringify({ title: "Owner Changed", version: bookmark.version }),
  });
  await expect(ownerStillUpdatesBookmark.json()).resolves.toEqual(
    expect.objectContaining({ id: bookmark.id, title: "Owner Changed", version: 2 }),
  );
  expect(ownerStillUpdatesBookmark.status).toBe(200);

  const revokeResponse = await request(`/folders/${folder.id}/share/${sharedUser.id}`, {
    method: "DELETE",
    headers: authHeaders(owner.token),
  });
  expect(revokeResponse.status).toBe(204);

  const revokedCannotReadFolder = await request(`/folders/${folder.id}`, {
    headers: authHeaders(sharedUser.token),
  });
  expect(revokedCannotReadFolder.status).toBe(404);

  const revokedCannotReadBookmark = await request(`/bookmarks/${bookmark.id}`, {
    headers: authHeaders(sharedUser.token),
  });
  expect(revokedCannotReadBookmark.status).toBe(404);
});

test("GET /bookmarks returns paginated data and validates pagination query parameters", async () => {
  const user = await registerUser("bookmark-pagination@example.com");
  const otherUser = await registerUser("bookmark-pagination-other@example.com");
  const created: Array<{ id: number; title: string; folder_id: number | null }> = [];

  for (let index = 1; index <= 7; index += 1) {
    created.push(
      await createBookmark(user.token, {
        url: `https://example.com/page-${index}`,
        title: `Page ${index}`,
      }),
    );
  }

  await createBookmark(otherUser.token, {
    url: "https://example.com/other-user",
    title: "Other user",
  });

  const defaultResponse = await request("/bookmarks", {
    headers: authHeaders(user.token),
  });
  await expect(defaultResponse.json()).resolves.toEqual({
    data: created.map((bookmark) => expect.objectContaining({ id: bookmark.id })),
    page: 1,
    limit: 20,
    total: 7,
  });
  expect(defaultResponse.status).toBe(200);

  const secondPageResponse = await request("/bookmarks?page=2&limit=5", {
    headers: authHeaders(user.token),
  });
  await expect(secondPageResponse.json()).resolves.toEqual({
    data: created.slice(5).map((bookmark) => expect.objectContaining({ id: bookmark.id })),
    page: 2,
    limit: 5,
    total: 7,
  });
  expect(secondPageResponse.status).toBe(200);

  const invalidQueries = ["page=0", "page=-1", "page=abc", "limit=0", "limit=200", "limit=abc"];
  for (const query of invalidQueries) {
    const response = await request(`/bookmarks?${query}`, {
      headers: authHeaders(user.token),
    });
    await expect(response.json()).resolves.toHaveProperty("error");
    expect(response.status).toBe(400);
  }
});

test("POST /bookmarks validates required fields", async () => {
  const user = await registerUser("bookmark-validation@example.com");
  const missingTitle = await request("/bookmarks", {
    method: "POST",
    headers: authHeaders(user.token),
    body: JSON.stringify({ url: "https://example.com" }),
  });
  expect(missingTitle.status).toBe(400);

  const missingUrl = await request("/bookmarks", {
    method: "POST",
    headers: authHeaders(user.token),
    body: JSON.stringify({ title: "Example" }),
  });
  expect(missingUrl.status).toBe(400);

  const emptyTitle = await request("/bookmarks", {
    method: "POST",
    headers: authHeaders(user.token),
    body: JSON.stringify({ url: "https://example.com", title: "   " }),
  });
  await expect(emptyTitle.json()).resolves.toHaveProperty("error");
  expect(emptyTitle.status).toBe(400);

  const blankTitle = await request("/bookmarks", {
    method: "POST",
    headers: authHeaders(user.token),
    body: JSON.stringify({ url: "https://example.com", title: "" }),
  });
  await expect(blankTitle.json()).resolves.toHaveProperty("error");
  expect(blankTitle.status).toBe(400);

  const emptyUrl = await request("/bookmarks", {
    method: "POST",
    headers: authHeaders(user.token),
    body: JSON.stringify({ url: "", title: "Test" }),
  });
  await expect(emptyUrl.json()).resolves.toHaveProperty("error");
  expect(emptyUrl.status).toBe(400);

  const whitespaceUrl = await request("/bookmarks", {
    method: "POST",
    headers: authHeaders(user.token),
    body: JSON.stringify({ url: "   ", title: "Test" }),
  });
  await expect(whitespaceUrl.json()).resolves.toHaveProperty("error");
  expect(whitespaceUrl.status).toBe(400);
});

test("PUT /bookmarks rejects empty provided title or url fields", async () => {
  const user = await registerUser("bookmark-update-validation@example.com");
  const createResponse = await request("/bookmarks", {
    method: "POST",
    headers: authHeaders(user.token),
    body: JSON.stringify({ url: "https://example.com", title: "Example" }),
  });
  const created = (await createResponse.json()) as { id: number; version: number };
  expect(createResponse.status).toBe(201);

  const emptyTitle = await request(`/bookmarks/${created.id}`, {
    method: "PUT",
    headers: authHeaders(user.token),
    body: JSON.stringify({ title: "", version: created.version }),
  });
  await expect(emptyTitle.json()).resolves.toHaveProperty("error");
  expect(emptyTitle.status).toBe(400);

  const whitespaceTitle = await request(`/bookmarks/${created.id}`, {
    method: "PUT",
    headers: authHeaders(user.token),
    body: JSON.stringify({ title: "   ", version: created.version }),
  });
  await expect(whitespaceTitle.json()).resolves.toHaveProperty("error");
  expect(whitespaceTitle.status).toBe(400);

  const emptyUrl = await request(`/bookmarks/${created.id}`, {
    method: "PUT",
    headers: authHeaders(user.token),
    body: JSON.stringify({ url: "", version: created.version }),
  });
  await expect(emptyUrl.json()).resolves.toHaveProperty("error");
  expect(emptyUrl.status).toBe(400);

  const whitespaceUrl = await request(`/bookmarks/${created.id}`, {
    method: "PUT",
    headers: authHeaders(user.token),
    body: JSON.stringify({ url: "   ", version: created.version }),
  });
  await expect(whitespaceUrl.json()).resolves.toHaveProperty("error");
  expect(whitespaceUrl.status).toBe(400);
});

test("missing bookmarks return 404 for read, update, and delete", async () => {
  const user = await registerUser("missing-bookmarks@example.com");
  const getResponse = await request("/bookmarks/9999", {
    headers: authHeaders(user.token),
  });
  expect(getResponse.status).toBe(404);

  const updateResponse = await request("/bookmarks/9999", {
    method: "PUT",
    headers: authHeaders(user.token),
    body: JSON.stringify({ title: "Missing" }),
  });
  expect(updateResponse.status).toBe(404);

  const deleteResponse = await request("/bookmarks/9999", { method: "DELETE", headers: authHeaders(user.token) });
  expect(deleteResponse.status).toBe(404);
});
