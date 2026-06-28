import { Router } from "express";
import { authenticatedUserId } from "./auth";
import { db } from "./database";
import { hydrateBookmarks, type Bookmark } from "./bookmarks";
import { userCanReadFolder, userHasSharedFolderAccess } from "./sharing";

interface Folder {
  id: number;
  user_id: number;
  name: string;
  created_at: string;
  updated_at: string;
}

type FolderInput = {
  name?: unknown;
};

type ShareInput = {
  email?: unknown;
};

type User = {
  id: number;
  email: string;
};

type SharedFolder = Folder & {
  shared_at: string;
};

const router = Router();

function parseId(value: string): number | null {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) {
    return null;
  }
  return id;
}

function findFolder(id: number, userId: number): Folder | undefined {
  return db.prepare("SELECT id, user_id, name, created_at, updated_at FROM folders WHERE id = ? AND user_id = ?").get(id, userId) as
    | Folder
    | undefined;
}

function findReadableFolder(id: number, userId: number): Folder | undefined {
  if (!userCanReadFolder(id, userId)) {
    return undefined;
  }

  return db.prepare("SELECT id, user_id, name, created_at, updated_at FROM folders WHERE id = ?").get(id) as Folder | undefined;
}

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

function findUserByEmail(email: string): User | undefined {
  return db.prepare("SELECT id, email FROM users WHERE email = ?").get(email) as User | undefined;
}

function validateFolderName(value: unknown): string | null {
  if (typeof value !== "string" || value.trim() === "") {
    return "name must be a non-empty string";
  }

  return null;
}

router.post("/", (req, res) => {
  const userId = authenticatedUserId(req);
  const body = req.body as FolderInput;
  const validationError = validateFolderName(body.name);

  if (validationError) {
    res.status(400).json({ error: validationError });
    return;
  }

  const now = new Date().toISOString();
  const result = db
    .prepare("INSERT INTO folders (user_id, name, created_at, updated_at) VALUES (?, ?, ?, ?)")
    .run(userId, (body.name as string).trim(), now, now);

  res.status(201).json(findFolder(Number(result.lastInsertRowid), userId));
});

router.get("/", (req, res) => {
  const userId = authenticatedUserId(req);
  const folders = db.prepare("SELECT id, user_id, name, created_at, updated_at FROM folders WHERE user_id = ? ORDER BY id ASC").all(userId) as
    Folder[];
  res.status(200).json(folders);
});

router.post("/:id/share", (req, res) => {
  const userId = authenticatedUserId(req);
  const id = parseId(req.params.id);

  if (id === null) {
    res.status(404).json({ error: "folder not found" });
    return;
  }

  const folder = findFolder(id, userId);
  if (!folder) {
    res.status(404).json({ error: "folder not found" });
    return;
  }

  const body = req.body as ShareInput;
  if (typeof body.email !== "string" || body.email.trim() === "") {
    res.status(400).json({ error: "email must be a non-empty string" });
    return;
  }

  const targetUser = findUserByEmail(normalizeEmail(body.email));
  if (!targetUser) {
    res.status(404).json({ error: "user not found" });
    return;
  }

  if (targetUser.id === userId) {
    res.status(400).json({ error: "cannot share a folder with its owner" });
    return;
  }

  const now = new Date().toISOString();
  db.prepare("INSERT OR IGNORE INTO folder_shares (folder_id, user_id, created_at) VALUES (?, ?, ?)").run(id, targetUser.id, now);
  const share = db.prepare("SELECT folder_id, user_id, created_at FROM folder_shares WHERE folder_id = ? AND user_id = ?").get(id, targetUser.id);

  res.status(201).json(share);
});

router.get("/:id", (req, res) => {
  const userId = authenticatedUserId(req);
  const id = parseId(req.params.id);

  if (id === null) {
    res.status(404).json({ error: "folder not found" });
    return;
  }

  const folder = findReadableFolder(id, userId);

  if (!folder) {
    res.status(404).json({ error: "folder not found" });
    return;
  }

  const bookmarks = db
    .prepare(
      "SELECT id, user_id, url, title, description, folder_id, version, created_at, updated_at FROM bookmarks WHERE folder_id = ? AND user_id = ? ORDER BY id ASC",
    )
    .all(id, folder.user_id) as Bookmark[];

  res.status(200).json({ ...folder, bookmarks: hydrateBookmarks(bookmarks) });
});

router.put("/:id", (req, res) => {
  const userId = authenticatedUserId(req);
  const id = parseId(req.params.id);

  if (id === null) {
    res.status(404).json({ error: "folder not found" });
    return;
  }

  const existing = findFolder(id, userId);

  if (!existing) {
    if (userHasSharedFolderAccess(id, userId)) {
      res.status(403).json({ error: "shared folders are read-only" });
      return;
    }

    res.status(404).json({ error: "folder not found" });
    return;
  }

  const body = req.body as FolderInput;
  const hasName = Object.prototype.hasOwnProperty.call(body, "name");
  const validationError = hasName ? validateFolderName(body.name) : null;

  if (validationError) {
    res.status(400).json({ error: validationError });
    return;
  }

  db.prepare("UPDATE folders SET name = ?, updated_at = ? WHERE id = ? AND user_id = ?").run(
    hasName ? (body.name as string).trim() : existing.name,
    new Date().toISOString(),
    id,
    userId,
  );

  res.status(200).json(findFolder(id, userId));
});

router.delete("/:id", (req, res) => {
  const userId = authenticatedUserId(req);
  const id = parseId(req.params.id);

  if (id === null) {
    res.status(404).json({ error: "folder not found" });
    return;
  }

  const deleteFolder = db.transaction((folderId: number, ownerId: number) => {
    const existing = findFolder(folderId, ownerId);

    if (!existing) {
      return false;
    }

    db.prepare("UPDATE bookmarks SET folder_id = NULL, version = version + 1, updated_at = ? WHERE folder_id = ? AND user_id = ?").run(
      new Date().toISOString(),
      folderId,
      ownerId,
    );
    db.prepare("DELETE FROM folders WHERE id = ? AND user_id = ?").run(folderId, ownerId);
    return true;
  });

  if (!deleteFolder(id, userId)) {
    if (userHasSharedFolderAccess(id, userId)) {
      res.status(403).json({ error: "shared folders are read-only" });
      return;
    }

    res.status(404).json({ error: "folder not found" });
    return;
  }

  res.status(204).send();
});

router.delete("/:id/share/:userId", (req, res) => {
  const ownerId = authenticatedUserId(req);
  const folderId = parseId(req.params.id);
  const targetUserId = parseId(req.params.userId);

  if (folderId === null || targetUserId === null) {
    res.status(404).json({ error: "folder not found" });
    return;
  }

  if (!findFolder(folderId, ownerId)) {
    res.status(404).json({ error: "folder not found" });
    return;
  }

  db.prepare("DELETE FROM folder_shares WHERE folder_id = ? AND user_id = ?").run(folderId, targetUserId);
  res.status(204).send();
});

const sharedRouter = Router();

sharedRouter.get("/folders", (req, res) => {
  const userId = authenticatedUserId(req);
  const folders = db
    .prepare(
      `
      SELECT folders.id, folders.user_id, folders.name, folders.created_at, folders.updated_at, folder_shares.created_at AS shared_at
      FROM folder_shares
      INNER JOIN folders ON folders.id = folder_shares.folder_id
      WHERE folder_shares.user_id = ?
      ORDER BY folder_shares.created_at ASC, folders.id ASC
    `,
    )
    .all(userId) as SharedFolder[];

  res.status(200).json(folders);
});

export { router as foldersRouter, sharedRouter };
