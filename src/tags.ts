import { Router } from "express";
import { authenticatedUserId } from "./auth";
import { db } from "./database";

export interface Tag {
  id: number;
  user_id: number;
  name: string;
  created_at: string;
  updated_at: string;
}

type TagInput = {
  name?: unknown;
};

const router = Router();

function parseId(value: string): number | null {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) {
    return null;
  }
  return id;
}

function validateTagName(value: unknown): string | null {
  if (typeof value !== "string" || value.trim() === "") {
    return "name must be a non-empty string";
  }

  return null;
}

function normalizeTagName(value: string): string {
  return value.trim();
}

function findTag(id: number, userId: number): Tag | undefined {
  return db.prepare("SELECT id, user_id, name, created_at, updated_at FROM tags WHERE id = ? AND user_id = ?").get(id, userId) as
    | Tag
    | undefined;
}

function tagNameExists(name: string, userId: number, exceptId?: number): boolean {
  const row =
    exceptId === undefined
      ? db.prepare("SELECT id FROM tags WHERE user_id = ? AND name = ?").get(userId, name)
      : db.prepare("SELECT id FROM tags WHERE user_id = ? AND name = ? AND id != ?").get(userId, name, exceptId);
  return Boolean(row);
}

router.post("/", (req, res) => {
  const userId = authenticatedUserId(req);
  const body = req.body as TagInput;
  const validationError = validateTagName(body.name);

  if (validationError) {
    res.status(400).json({ error: validationError });
    return;
  }

  const name = normalizeTagName(body.name as string);
  if (tagNameExists(name, userId)) {
    res.status(409).json({ error: "tag name already exists" });
    return;
  }

  const now = new Date().toISOString();
  const result = db.prepare("INSERT INTO tags (user_id, name, created_at, updated_at) VALUES (?, ?, ?, ?)").run(userId, name, now, now);

  res.status(201).json(findTag(Number(result.lastInsertRowid), userId));
});

router.get("/", (req, res) => {
  const userId = authenticatedUserId(req);
  const tags = db.prepare("SELECT id, user_id, name, created_at, updated_at FROM tags WHERE user_id = ? ORDER BY id ASC").all(userId) as Tag[];

  res.status(200).json(tags);
});

router.put("/:id", (req, res) => {
  const userId = authenticatedUserId(req);
  const id = parseId(req.params.id);

  if (id === null) {
    res.status(404).json({ error: "tag not found" });
    return;
  }

  const existing = findTag(id, userId);
  if (!existing) {
    res.status(404).json({ error: "tag not found" });
    return;
  }

  const body = req.body as TagInput;
  const validationError = validateTagName(body.name);

  if (validationError) {
    res.status(400).json({ error: validationError });
    return;
  }

  const name = normalizeTagName(body.name as string);
  if (tagNameExists(name, userId, id)) {
    res.status(409).json({ error: "tag name already exists" });
    return;
  }

  db.prepare("UPDATE tags SET name = ?, updated_at = ? WHERE id = ? AND user_id = ?").run(name, new Date().toISOString(), id, userId);

  res.status(200).json(findTag(id, userId));
});

router.delete("/:id", (req, res) => {
  const userId = authenticatedUserId(req);
  const id = parseId(req.params.id);

  if (id === null) {
    res.status(404).json({ error: "tag not found" });
    return;
  }

  const result = db.prepare("DELETE FROM tags WHERE id = ? AND user_id = ?").run(id, userId);

  if (result.changes === 0) {
    res.status(404).json({ error: "tag not found" });
    return;
  }

  res.status(204).send();
});

export { router as tagsRouter };
