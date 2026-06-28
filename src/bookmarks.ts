import { Router } from "express";
import { createHmac, timingSafeEqual } from "node:crypto";
import { authenticatedUserId } from "./auth";
import { db } from "./database";
import { userCanReadBookmark, userHasSharedBookmarkAccess, userHasSharedFolderAccess, userOwnsFolder } from "./sharing";
import type { Tag } from "./tags";

export interface Bookmark {
  id: number;
  user_id: number;
  url: string;
  title: string;
  description: string | null;
  folder_id: number | null;
  version: number;
  created_at: string;
  updated_at: string;
}

type BookmarkInput = {
  url?: unknown;
  title?: unknown;
  description?: unknown;
  folder_id?: unknown;
  tag_ids?: unknown;
  version?: unknown;
};

export type BookmarkWithTags = Bookmark & {
  tags: Tag[];
};

type PaginationParams = {
  page: number;
  limit: number;
};

type CursorPayload = {
  v: 1;
  createdAt: string;
  id: number;
};

type CursorParams = {
  cursor: CursorPayload | null;
  limit: number;
};

type SearchQuery = {
  raw: string;
  like: string;
  prefixLike: string;
};

type BookmarkListFilter = {
  whereSql: string;
  params: unknown[];
  orderSql: string;
  orderParams: unknown[];
};

const router = Router();
const CURSOR_SECRET = "benchmark-cursor-secret";

function findBookmarkRow(id: number, userId: number): Bookmark | undefined {
  return db
    .prepare("SELECT id, user_id, url, title, description, folder_id, version, created_at, updated_at FROM bookmarks WHERE id = ? AND user_id = ?")
    .get(id, userId) as Bookmark | undefined;
}

function findReadableBookmarkRow(id: number, userId: number): Bookmark | undefined {
  if (!userCanReadBookmark(id, userId)) {
    return undefined;
  }

  return db
    .prepare("SELECT id, user_id, url, title, description, folder_id, version, created_at, updated_at FROM bookmarks WHERE id = ?")
    .get(id) as Bookmark | undefined;
}

export function findBookmark(id: number, userId: number): BookmarkWithTags | undefined {
  const bookmark = findBookmarkRow(id, userId);

  if (!bookmark) {
    return undefined;
  }

  return hydrateBookmark(bookmark);
}

function parseId(value: string): number | null {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) {
    return null;
  }
  return id;
}

function parsePaginationNumber(
  value: unknown,
  fieldName: "page" | "limit",
  defaultValue: number,
  maxValue?: number,
): { value: number; error: string | null } {
  if (value === undefined) {
    return { value: defaultValue, error: null };
  }

  if (typeof value !== "string" || !/^\d+$/.test(value)) {
    return { value: defaultValue, error: `${fieldName} must be a positive integer` };
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || (maxValue !== undefined && parsed > maxValue)) {
    return { value: defaultValue, error: `${fieldName} must be between 1 and ${maxValue ?? "the maximum allowed value"}` };
  }

  return { value: parsed, error: null };
}

function parsePagination(query: { page?: unknown; limit?: unknown }): { pagination: PaginationParams | null; error: string | null } {
  const page = parsePaginationNumber(query.page, "page", 1);
  if (page.error) {
    return { pagination: null, error: page.error };
  }

  const limit = parsePaginationNumber(query.limit, "limit", 20, 100);
  if (limit.error) {
    return { pagination: null, error: limit.error };
  }

  return { pagination: { page: page.value, limit: limit.value }, error: null };
}

function signCursorPayload(payload: string): string {
  return createHmac("sha256", CURSOR_SECRET).update(payload).digest("base64url");
}

function encodeCursor(cursor: CursorPayload): string {
  const payload = Buffer.from(JSON.stringify(cursor)).toString("base64url");
  return `${payload}.${signCursorPayload(payload)}`;
}

function decodeCursor(value: string): CursorPayload | null {
  const [payload, signature, extra] = value.split(".");
  if (!payload || !signature || extra !== undefined) {
    return null;
  }

  const expectedSignature = signCursorPayload(payload);
  const provided = Buffer.from(signature);
  const expected = Buffer.from(expectedSignature);
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    return null;
  }

  try {
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Partial<CursorPayload>;
    if (decoded.v !== 1 || typeof decoded.createdAt !== "string" || typeof decoded.id !== "number" || !Number.isInteger(decoded.id) || decoded.id <= 0) {
      return null;
    }

    return { v: 1, createdAt: decoded.createdAt, id: decoded.id };
  } catch {
    return null;
  }
}

function parseCursorPagination(query: { cursor?: unknown; limit?: unknown }): { cursorPagination: CursorParams | null; error: string | null } {
  const limit = parsePaginationNumber(query.limit, "limit", 20, 100);
  if (limit.error) {
    return { cursorPagination: null, error: limit.error };
  }

  if (query.cursor === undefined) {
    return { cursorPagination: { cursor: null, limit: limit.value }, error: null };
  }

  if (typeof query.cursor !== "string") {
    return { cursorPagination: null, error: "cursor must be a valid cursor token" };
  }

  if (query.cursor.trim() === "") {
    return { cursorPagination: { cursor: null, limit: limit.value }, error: null };
  }

  const cursor = decodeCursor(query.cursor);
  if (!cursor) {
    return { cursorPagination: null, error: "cursor must be a valid cursor token" };
  }

  return { cursorPagination: { cursor, limit: limit.value }, error: null };
}

function validateRequiredBookmarkInput(body: BookmarkInput): string | null {
  if (typeof body.url !== "string" || body.url.trim() === "") {
    return "url must be a non-empty string";
  }

  if (typeof body.title !== "string" || body.title.trim() === "") {
    return "title must be a non-empty string";
  }

  return null;
}

function validateOptionalBookmarkInput(body: BookmarkInput): string | null {
  if (Object.prototype.hasOwnProperty.call(body, "url") && (typeof body.url !== "string" || body.url.trim() === "")) {
    return "url must be a non-empty string";
  }

  if (Object.prototype.hasOwnProperty.call(body, "title") && (typeof body.title !== "string" || body.title.trim() === "")) {
    return "title must be a non-empty string";
  }

  return null;
}

function parseBookmarkVersion(value: unknown): { version: number | null; error: string | null } {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    return { version: null, error: "version must be a positive integer" };
  }

  return { version: value, error: null };
}

function normalizeDescription(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  return value;
}

function parseFolderId(value: unknown, userId: number): { folderId: number | null; error: string | null; status: 400 | 403 } {
  if (value === undefined || value === null) {
    return { folderId: null, error: null, status: 400 };
  }

  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    return { folderId: null, error: "folder_id must be a valid folder id", status: 400 };
  }

  if (userOwnsFolder(value, userId)) {
    return { folderId: value, error: null, status: 400 };
  }

  if (userHasSharedFolderAccess(value, userId)) {
    return { folderId: null, error: "shared folders are read-only", status: 403 };
  }

  return { folderId: null, error: "folder_id does not reference an existing folder", status: 400 };
}

function getTagsForBookmark(bookmarkId: number): Tag[] {
  return db
    .prepare(
      `
      SELECT tags.id, tags.user_id, tags.name, tags.created_at, tags.updated_at
      FROM tags
      INNER JOIN bookmark_tags ON bookmark_tags.tag_id = tags.id
      WHERE bookmark_tags.bookmark_id = ?
      ORDER BY tags.id ASC
    `,
    )
    .all(bookmarkId) as Tag[];
}

export function hydrateBookmark(bookmark: Bookmark): BookmarkWithTags {
  return { ...bookmark, tags: getTagsForBookmark(bookmark.id) };
}

export function hydrateBookmarks(bookmarks: Bookmark[]): BookmarkWithTags[] {
  if (bookmarks.length === 0) {
    return [];
  }

  const placeholders = bookmarks.map(() => "?").join(", ");
  const tagRows = db
    .prepare(
      `
      SELECT bookmark_tags.bookmark_id, tags.id, tags.user_id, tags.name, tags.created_at, tags.updated_at
      FROM bookmark_tags
      INNER JOIN tags ON tags.id = bookmark_tags.tag_id
      WHERE bookmark_tags.bookmark_id IN (${placeholders})
      ORDER BY bookmark_tags.bookmark_id ASC, tags.id ASC
    `,
    )
    .all(...bookmarks.map((bookmark) => bookmark.id)) as Array<Tag & { bookmark_id: number }>;
  const tagsByBookmarkId = new Map<number, Tag[]>();

  for (const row of tagRows) {
    const tags = tagsByBookmarkId.get(row.bookmark_id) ?? [];
    tags.push({
      id: row.id,
      user_id: row.user_id,
      name: row.name,
      created_at: row.created_at,
      updated_at: row.updated_at,
    });
    tagsByBookmarkId.set(row.bookmark_id, tags);
  }

  return bookmarks.map((bookmark) => ({ ...bookmark, tags: tagsByBookmarkId.get(bookmark.id) ?? [] }));
}

function parseTagIds(value: unknown, userId: number): { tagIds: number[]; error: string | null } {
  if (value === undefined) {
    return { tagIds: [], error: null };
  }

  if (!Array.isArray(value)) {
    return { tagIds: [], error: "tag_ids must be an array of tag ids" };
  }

  const tagIds = [...new Set(value)];

  if (!tagIds.every((tagId) => typeof tagId === "number" && Number.isInteger(tagId) && tagId > 0)) {
    return { tagIds: [], error: "tag_ids must contain valid tag ids" };
  }

  if (tagIds.length === 0) {
    return { tagIds: [], error: null };
  }

  const placeholders = tagIds.map(() => "?").join(", ");
  const rows = db.prepare(`SELECT id FROM tags WHERE user_id = ? AND id IN (${placeholders})`).all(userId, ...tagIds) as Array<{ id: number }>;

  if (rows.length !== tagIds.length) {
    return { tagIds: [], error: "tag_ids must reference existing tags" };
  }

  return { tagIds, error: null };
}

function replaceBookmarkTags(bookmarkId: number, tagIds: number[]): void {
  db.prepare("DELETE FROM bookmark_tags WHERE bookmark_id = ?").run(bookmarkId);

  const insert = db.prepare("INSERT INTO bookmark_tags (bookmark_id, tag_id) VALUES (?, ?)");
  for (const tagId of tagIds) {
    insert.run(bookmarkId, tagId);
  }
}

function parseTagFilter(query: { tag?: unknown; tags?: unknown }): { tagNames: string[]; error: string | null } {
  const values: string[] = [];

  for (const field of [query.tag, query.tags]) {
    if (field === undefined) {
      continue;
    }

    if (typeof field !== "string") {
      return { tagNames: [], error: "tag filter must be a string" };
    }

    values.push(...field.split(",").map((value) => value.trim()));
  }

  const tagNames = [...new Set(values.filter((value) => value !== ""))];
  if ((query.tag !== undefined || query.tags !== undefined) && tagNames.length === 0) {
    return { tagNames: [], error: "tag filter must include at least one tag name" };
  }

  return { tagNames, error: null };
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

function parseSearchQuery(query: { q?: unknown }): { searchQuery: SearchQuery | null; error: string | null } {
  if (query.q === undefined) {
    return { searchQuery: null, error: null };
  }

  if (typeof query.q !== "string") {
    return { searchQuery: null, error: "q must be a string" };
  }

  if (query.q.length > 200) {
    return { searchQuery: null, error: "q must be 200 characters or fewer" };
  }

  const raw = query.q.trim();
  if (raw === "") {
    return { searchQuery: null, error: null };
  }

  const escaped = escapeLike(raw);
  return {
    searchQuery: {
      raw,
      like: `%${escaped}%`,
      prefixLike: `${escaped}%`,
    },
    error: null,
  };
}

function bookmarkListFilterSql(tagNames: string[], searchQuery: SearchQuery | null): BookmarkListFilter {
  const whereParts = ["bookmarks.user_id = ?"];
  const params: unknown[] = [];

  if (tagNames.length > 0) {
    const placeholders = tagNames.map(() => "?").join(", ");
    whereParts.push(`
      EXISTS (
        SELECT 1
        FROM bookmark_tags
        INNER JOIN tags ON tags.id = bookmark_tags.tag_id
        WHERE bookmark_tags.bookmark_id = bookmarks.id
          AND tags.user_id = bookmarks.user_id
          AND tags.name IN (${placeholders})
      )
    `);
    params.push(...tagNames);
  }

  if (searchQuery) {
    whereParts.push(`
      (
        bookmarks.title LIKE ? ESCAPE '\\'
        OR bookmarks.url LIKE ? ESCAPE '\\'
        OR COALESCE(bookmarks.description, '') LIKE ? ESCAPE '\\'
        OR EXISTS (
          SELECT 1
          FROM folders
          WHERE folders.id = bookmarks.folder_id
            AND folders.user_id = bookmarks.user_id
            AND folders.name LIKE ? ESCAPE '\\'
        )
        OR EXISTS (
          SELECT 1
          FROM bookmark_tags
          INNER JOIN tags ON tags.id = bookmark_tags.tag_id
          WHERE bookmark_tags.bookmark_id = bookmarks.id
            AND tags.user_id = bookmarks.user_id
            AND tags.name LIKE ? ESCAPE '\\'
        )
      )
    `);
    params.push(searchQuery.like, searchQuery.like, searchQuery.like, searchQuery.like, searchQuery.like);
  }

  if (!searchQuery) {
    return {
      whereSql: `WHERE ${whereParts.join(" AND ")}`,
      params,
      orderSql: "bookmarks.created_at ASC, bookmarks.id ASC",
      orderParams: [],
    };
  }

  return {
    whereSql: `WHERE ${whereParts.join(" AND ")}`,
    params,
    orderSql: `
      CASE
        WHEN bookmarks.title = ? COLLATE NOCASE THEN 1
        WHEN bookmarks.title LIKE ? ESCAPE '\\' THEN 2
        WHEN bookmarks.title LIKE ? ESCAPE '\\' THEN 3
        ELSE 4
      END ASC,
      bookmarks.id ASC
    `,
    orderParams: [searchQuery.raw, searchQuery.prefixLike, searchQuery.like],
  };
}

router.post("/", (req, res) => {
  const userId = authenticatedUserId(req);
  const body = req.body as BookmarkInput;
  const validationError = validateRequiredBookmarkInput(body);

  if (validationError) {
    res.status(400).json({ error: validationError });
    return;
  }

  const parsedFolder = parseFolderId(body.folder_id, userId);
  if (parsedFolder.error) {
    res.status(parsedFolder.status).json({ error: parsedFolder.error });
    return;
  }

  const parsedTags = parseTagIds(body.tag_ids, userId);
  if (parsedTags.error) {
    res.status(400).json({ error: parsedTags.error });
    return;
  }

  const now = new Date().toISOString();
  const createBookmark = db.transaction(() => {
    const result = db
      .prepare(
        `
        INSERT INTO bookmarks (user_id, url, title, description, folder_id, version, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 1, ?, ?)
      `,
      )
      .run(
        userId,
        (body.url as string).trim(),
        (body.title as string).trim(),
        normalizeDescription(body.description),
        parsedFolder.folderId,
        now,
        now,
      );

    const bookmarkId = Number(result.lastInsertRowid);
    replaceBookmarkTags(bookmarkId, parsedTags.tagIds);
    return bookmarkId;
  });

  const bookmark = findBookmark(createBookmark(), userId);
  res.status(201).json(bookmark);
});

router.get("/", (req, res) => {
  const userId = authenticatedUserId(req);
  const parsedTagFilter = parseTagFilter(req.query);
  if (parsedTagFilter.error) {
    res.status(400).json({ error: parsedTagFilter.error });
    return;
  }

  const parsedSearchQuery = parseSearchQuery(req.query);
  if (parsedSearchQuery.error) {
    res.status(400).json({ error: parsedSearchQuery.error });
    return;
  }

  const filter = bookmarkListFilterSql(parsedTagFilter.tagNames, parsedSearchQuery.searchQuery);

  if (req.query.cursor !== undefined) {
    const parsedCursorPagination = parseCursorPagination(req.query);
    if (parsedCursorPagination.error || !parsedCursorPagination.cursorPagination) {
      res.status(400).json({ error: parsedCursorPagination.error });
      return;
    }

    const cursorWhere = parsedCursorPagination.cursorPagination.cursor
      ? " AND (bookmarks.created_at > ? OR (bookmarks.created_at = ? AND bookmarks.id > ?))"
      : "";
    const cursorParams = parsedCursorPagination.cursorPagination.cursor
      ? [
          parsedCursorPagination.cursorPagination.cursor.createdAt,
          parsedCursorPagination.cursorPagination.cursor.createdAt,
          parsedCursorPagination.cursorPagination.cursor.id,
        ]
      : [];
    const rows = db
      .prepare(
        `
        SELECT id, user_id, url, title, description, folder_id, version, created_at, updated_at
        FROM bookmarks
        ${filter.whereSql}${cursorWhere}
        ORDER BY bookmarks.created_at ASC, bookmarks.id ASC
        LIMIT ?
      `,
      )
      .all(userId, ...filter.params, ...cursorParams, parsedCursorPagination.cursorPagination.limit + 1) as Bookmark[];
    const pageRows = rows.slice(0, parsedCursorPagination.cursorPagination.limit);
    const lastBookmark = pageRows.at(-1);

    res.status(200).json({
      data: hydrateBookmarks(pageRows),
      limit: parsedCursorPagination.cursorPagination.limit,
      nextCursor:
        rows.length > parsedCursorPagination.cursorPagination.limit && lastBookmark
          ? encodeCursor({ v: 1, createdAt: lastBookmark.created_at, id: lastBookmark.id })
          : null,
      hasMore: rows.length > parsedCursorPagination.cursorPagination.limit,
    });
    return;
  }

  const parsedPagination = parsePagination(req.query);
  if (parsedPagination.error || !parsedPagination.pagination) {
    res.status(400).json({ error: parsedPagination.error });
    return;
  }

  const { page, limit } = parsedPagination.pagination;
  const offset = (page - 1) * limit;
  const totalRow = db.prepare(`SELECT COUNT(*) AS total FROM bookmarks ${filter.whereSql}`).get(userId, ...filter.params) as { total: number };
  const bookmarks = db
    .prepare(
      `
      SELECT id, user_id, url, title, description, folder_id, version, created_at, updated_at
      FROM bookmarks
      ${filter.whereSql}
      ORDER BY ${filter.orderSql}
      LIMIT ? OFFSET ?
    `,
    )
    .all(userId, ...filter.params, ...filter.orderParams, limit, offset) as Bookmark[];

  res.status(200).json({
    data: hydrateBookmarks(bookmarks),
    page,
    limit,
    total: totalRow.total,
  });
});

router.get("/:id", (req, res) => {
  const userId = authenticatedUserId(req);
  const id = parseId(req.params.id);

  if (id === null) {
    res.status(404).json({ error: "bookmark not found" });
    return;
  }

  const bookmark = findReadableBookmarkRow(id, userId);

  if (!bookmark) {
    res.status(404).json({ error: "bookmark not found" });
    return;
  }

  res.status(200).json(hydrateBookmark(bookmark));
});

router.put("/:id", (req, res) => {
  const userId = authenticatedUserId(req);
  const id = parseId(req.params.id);

  if (id === null) {
    res.status(404).json({ error: "bookmark not found" });
    return;
  }

  const existing = findBookmarkRow(id, userId);

  if (!existing) {
    if (userHasSharedBookmarkAccess(id, userId)) {
      res.status(403).json({ error: "shared bookmarks are read-only" });
      return;
    }

    res.status(404).json({ error: "bookmark not found" });
    return;
  }

  const body = req.body as BookmarkInput;
  const parsedVersion = parseBookmarkVersion(body.version);

  if (parsedVersion.error || parsedVersion.version === null) {
    res.status(400).json({ error: parsedVersion.error });
    return;
  }

  if (parsedVersion.version !== existing.version) {
    res.status(409).json(hydrateBookmark(existing));
    return;
  }

  const validationError = validateOptionalBookmarkInput(body);

  if (validationError) {
    res.status(400).json({ error: validationError });
    return;
  }

  const nextUrl = typeof body.url === "string" ? body.url.trim() : existing.url;
  const nextTitle = typeof body.title === "string" ? body.title.trim() : existing.title;
  const nextDescription =
    Object.prototype.hasOwnProperty.call(body, "description") ? normalizeDescription(body.description) : existing.description;
  const nextFolder = Object.prototype.hasOwnProperty.call(body, "folder_id")
    ? parseFolderId(body.folder_id, userId)
    : { folderId: existing.folder_id, error: null };

  if (nextFolder.error) {
    res.status(nextFolder.status).json({ error: nextFolder.error });
    return;
  }

  const shouldReplaceTags = Object.prototype.hasOwnProperty.call(body, "tag_ids");
  const nextTags = shouldReplaceTags ? parseTagIds(body.tag_ids, userId) : { tagIds: [], error: null };

  if (nextTags.error) {
    res.status(400).json({ error: nextTags.error });
    return;
  }

  const updateBookmark = db.transaction((): BookmarkWithTags | null => {
    const result = db.prepare(
      `
      UPDATE bookmarks
      SET url = ?, title = ?, description = ?, folder_id = ?, version = version + 1, updated_at = ?
      WHERE id = ? AND user_id = ? AND version = ?
    `,
    ).run(nextUrl, nextTitle, nextDescription, nextFolder.folderId, new Date().toISOString(), id, userId, parsedVersion.version);

    if (result.changes === 0) {
      return null;
    }

    if (shouldReplaceTags) {
      replaceBookmarkTags(id, nextTags.tagIds);
    }

    return findBookmark(id, userId) ?? null;
  });

  const updated = updateBookmark();

  if (!updated) {
    const current = findBookmark(id, userId);
    if (!current) {
      res.status(404).json({ error: "bookmark not found" });
      return;
    }

    res.status(409).json(current);
    return;
  }

  res.status(200).json(updated);
});

router.delete("/:id", (req, res) => {
  const userId = authenticatedUserId(req);
  const id = parseId(req.params.id);

  if (id === null) {
    res.status(404).json({ error: "bookmark not found" });
    return;
  }

  const result = db.prepare("DELETE FROM bookmarks WHERE id = ? AND user_id = ?").run(id, userId);

  if (result.changes === 0) {
    if (userHasSharedBookmarkAccess(id, userId)) {
      res.status(403).json({ error: "shared bookmarks are read-only" });
      return;
    }

    res.status(404).json({ error: "bookmark not found" });
    return;
  }

  res.status(204).send();
});

export { router as bookmarksRouter };
