import { Router } from "express";
import { authenticatedUserId } from "./auth";
import { db } from "./database";

type ExportFolder = {
  id: number;
  name: string;
  created_at: string;
  updated_at: string;
};

type ExportTag = {
  id: number;
  name: string;
  created_at: string;
  updated_at: string;
};

type ExportBookmark = {
  id: number;
  url: string;
  title: string;
  description: string | null;
  folder_id: number | null;
  tag_ids: number[];
  version?: number;
  created_at: string;
  updated_at: string;
};

type ExportPayload = {
  version: 1;
  folders: ExportFolder[];
  tags: ExportTag[];
  bookmarks: ExportBookmark[];
};

type ImportSummary = {
  imported: number;
  skipped: number;
  updated: number;
};

type ExistingBookmark = {
  id: number;
  url: string;
  title: string;
  description: string | null;
  folder_id: number | null;
};

const router = Router();

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function isStringOrNull(value: unknown): value is string | null {
  return typeof value === "string" || value === null;
}

function normalizeUrlForDedupe(url: string): string {
  const trimmed = url.trim();

  try {
    const parsed = new URL(trimmed);
    parsed.protocol = parsed.protocol.toLowerCase();
    parsed.hostname = parsed.hostname.toLowerCase();
    parsed.hash = "";

    if ((parsed.protocol === "http:" && parsed.port === "80") || (parsed.protocol === "https:" && parsed.port === "443")) {
      parsed.port = "";
    }

    return parsed.toString();
  } catch {
    return trimmed;
  }
}

function parseImportPayload(value: unknown): { payload: ExportPayload | null; error: string | null } {
  if (!isPlainObject(value) || value.version !== 1 || !Array.isArray(value.folders) || !Array.isArray(value.tags) || !Array.isArray(value.bookmarks)) {
    return { payload: null, error: "invalid import payload" };
  }

  const folderIds = new Set<number>();
  const folders: ExportFolder[] = [];
  for (const folder of value.folders) {
    if (!isPlainObject(folder) || !isPositiveInteger(folder.id) || typeof folder.name !== "string" || folder.name.trim() === "") {
      return { payload: null, error: "invalid folder import payload" };
    }
    folderIds.add(folder.id);
    folders.push({
      id: folder.id,
      name: folder.name.trim(),
      created_at: typeof folder.created_at === "string" ? folder.created_at : "",
      updated_at: typeof folder.updated_at === "string" ? folder.updated_at : "",
    });
  }

  const tagIds = new Set<number>();
  const tags: ExportTag[] = [];
  for (const tag of value.tags) {
    if (!isPlainObject(tag) || !isPositiveInteger(tag.id) || typeof tag.name !== "string" || tag.name.trim() === "") {
      return { payload: null, error: "invalid tag import payload" };
    }
    tagIds.add(tag.id);
    tags.push({
      id: tag.id,
      name: tag.name.trim(),
      created_at: typeof tag.created_at === "string" ? tag.created_at : "",
      updated_at: typeof tag.updated_at === "string" ? tag.updated_at : "",
    });
  }

  const bookmarks: ExportBookmark[] = [];
  for (const bookmark of value.bookmarks) {
    if (
      !isPlainObject(bookmark) ||
      !isPositiveInteger(bookmark.id) ||
      typeof bookmark.url !== "string" ||
      bookmark.url.trim() === "" ||
      typeof bookmark.title !== "string" ||
      bookmark.title.trim() === "" ||
      !isStringOrNull(bookmark.description ?? null)
    ) {
      return { payload: null, error: "invalid bookmark import payload" };
    }

    const folderId = bookmark.folder_id ?? null;
    if (folderId !== null && (!isPositiveInteger(folderId) || !folderIds.has(folderId))) {
      return { payload: null, error: "invalid bookmark folder association" };
    }

    const rawTagIds = bookmark.tag_ids ?? [];
    if (!Array.isArray(rawTagIds) || !rawTagIds.every((tagId) => isPositiveInteger(tagId) && tagIds.has(tagId))) {
      return { payload: null, error: "invalid bookmark tag association" };
    }

    const description: string | null = typeof bookmark.description === "string" ? bookmark.description : null;
    bookmarks.push({
      id: bookmark.id,
      url: bookmark.url.trim(),
      title: bookmark.title.trim(),
      description,
      folder_id: folderId,
      tag_ids: [...new Set(rawTagIds)],
      created_at: typeof bookmark.created_at === "string" ? bookmark.created_at : "",
      updated_at: typeof bookmark.updated_at === "string" ? bookmark.updated_at : "",
    });
  }

  return { payload: { version: 1, folders, tags, bookmarks }, error: null };
}

function tagsForBookmark(bookmarkId: number): number[] {
  const rows = db.prepare("SELECT tag_id FROM bookmark_tags WHERE bookmark_id = ? ORDER BY tag_id ASC").all(bookmarkId) as Array<{ tag_id: number }>;
  return rows.map((row) => row.tag_id);
}

function sameNumberSet(left: number[], right: number[]): boolean {
  if (left.length !== right.length) {
    return false;
  }

  const rightValues = new Set(right);
  return left.every((value) => rightValues.has(value));
}

function syncBookmarkTags(bookmarkId: number, tagIds: number[]): boolean {
  const existing = tagsForBookmark(bookmarkId);
  const desired = [...new Set(tagIds)].sort((left, right) => left - right);

  if (sameNumberSet(existing, desired)) {
    return false;
  }

  db.prepare("DELETE FROM bookmark_tags WHERE bookmark_id = ?").run(bookmarkId);
  const insert = db.prepare("INSERT OR IGNORE INTO bookmark_tags (bookmark_id, tag_id) VALUES (?, ?)");
  for (const tagId of desired) {
    insert.run(bookmarkId, tagId);
  }

  return true;
}

router.get("/export", (req, res) => {
  const userId = authenticatedUserId(req);
  const folders = db
    .prepare("SELECT id, name, created_at, updated_at FROM folders WHERE user_id = ? ORDER BY id ASC")
    .all(userId) as ExportFolder[];
  const tags = db.prepare("SELECT id, name, created_at, updated_at FROM tags WHERE user_id = ? ORDER BY id ASC").all(userId) as ExportTag[];
  const bookmarks = db
    .prepare(
      `
      SELECT id, url, title, description, folder_id, version, created_at, updated_at
      FROM bookmarks
      WHERE user_id = ?
      ORDER BY id ASC
    `,
    )
    .all(userId) as Array<Omit<ExportBookmark, "tag_ids">>;

  res.status(200).json({
    version: 1,
    folders,
    tags,
    bookmarks: bookmarks.map((bookmark) => ({ ...bookmark, tag_ids: tagsForBookmark(bookmark.id) })),
  });
});

router.post("/import", (req, res) => {
  const userId = authenticatedUserId(req);
  const parsed = parseImportPayload(req.body);

  if (parsed.error || !parsed.payload) {
    res.status(400).json({ error: parsed.error });
    return;
  }

  const importData = db.transaction((payload: ExportPayload): ImportSummary => {
    const summary: ImportSummary = { imported: 0, skipped: 0, updated: 0 };
    const folderIdMap = new Map<number, number>();
    const tagIdMap = new Map<number, number>();
    const now = new Date().toISOString();

    for (const folder of payload.folders) {
      const existing = db.prepare("SELECT id FROM folders WHERE user_id = ? AND name = ? ORDER BY id ASC LIMIT 1").get(userId, folder.name) as
        | { id: number }
        | undefined;

      if (existing) {
        folderIdMap.set(folder.id, existing.id);
        summary.skipped += 1;
        continue;
      }

      const result = db.prepare("INSERT INTO folders (user_id, name, created_at, updated_at) VALUES (?, ?, ?, ?)").run(userId, folder.name, now, now);
      folderIdMap.set(folder.id, Number(result.lastInsertRowid));
      summary.imported += 1;
    }

    for (const tag of payload.tags) {
      const existing = db.prepare("SELECT id FROM tags WHERE user_id = ? AND name = ?").get(userId, tag.name) as { id: number } | undefined;

      if (existing) {
        tagIdMap.set(tag.id, existing.id);
        summary.skipped += 1;
        continue;
      }

      const result = db.prepare("INSERT INTO tags (user_id, name, created_at, updated_at) VALUES (?, ?, ?, ?)").run(userId, tag.name, now, now);
      tagIdMap.set(tag.id, Number(result.lastInsertRowid));
      summary.imported += 1;
    }

    const existingBookmarks = db
      .prepare("SELECT id, url, title, description, folder_id FROM bookmarks WHERE user_id = ? ORDER BY id ASC")
      .all(userId) as ExistingBookmark[];
    const bookmarkByNormalizedUrl = new Map<string, ExistingBookmark>();
    for (const bookmark of existingBookmarks) {
      if (!bookmarkByNormalizedUrl.has(normalizeUrlForDedupe(bookmark.url))) {
        bookmarkByNormalizedUrl.set(normalizeUrlForDedupe(bookmark.url), bookmark);
      }
    }

    for (const bookmark of payload.bookmarks) {
      const normalizedUrl = normalizeUrlForDedupe(bookmark.url);
      const folderId = bookmark.folder_id === null ? null : (folderIdMap.get(bookmark.folder_id) ?? null);
      const tagIds = bookmark.tag_ids.map((tagId) => tagIdMap.get(tagId)).filter((tagId): tagId is number => tagId !== undefined);
      const existing = bookmarkByNormalizedUrl.get(normalizedUrl);

      if (!existing) {
        const result = db
          .prepare(
            `
            INSERT INTO bookmarks (user_id, url, title, description, folder_id, version, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, 1, ?, ?)
          `,
          )
          .run(userId, bookmark.url, bookmark.title, bookmark.description, folderId, now, now);
        const bookmarkId = Number(result.lastInsertRowid);
        syncBookmarkTags(bookmarkId, tagIds);
        bookmarkByNormalizedUrl.set(normalizedUrl, {
          id: bookmarkId,
          url: bookmark.url,
          title: bookmark.title,
          description: bookmark.description,
          folder_id: folderId,
        });
        summary.imported += 1;
        continue;
      }

      const metadataChanged =
        existing.url !== bookmark.url ||
        existing.title !== bookmark.title ||
        existing.description !== bookmark.description ||
        existing.folder_id !== folderId;
      const tagsChanged = syncBookmarkTags(existing.id, tagIds);

      if (metadataChanged) {
        db.prepare(
          "UPDATE bookmarks SET url = ?, title = ?, description = ?, folder_id = ?, version = version + 1, updated_at = ? WHERE id = ? AND user_id = ?",
        ).run(
          bookmark.url,
          bookmark.title,
          bookmark.description,
          folderId,
          now,
          existing.id,
          userId,
        );
        existing.url = bookmark.url;
        existing.title = bookmark.title;
        existing.description = bookmark.description;
        existing.folder_id = folderId;
      }

      if (metadataChanged || tagsChanged) {
        summary.updated += 1;
      } else {
        summary.skipped += 1;
      }
    }

    return summary;
  });

  res.status(200).json(importData(parsed.payload));
});

export { router as portabilityRouter };
