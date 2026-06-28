import { db } from "./database";

export interface FolderShare {
  folder_id: number;
  user_id: number;
  created_at: string;
}

export function userOwnsFolder(folderId: number, userId: number): boolean {
  const folder = db.prepare("SELECT id FROM folders WHERE id = ? AND user_id = ?").get(folderId, userId);
  return Boolean(folder);
}

export function userCanReadFolder(folderId: number, userId: number): boolean {
  const folder = db
    .prepare(
      `
      SELECT folders.id
      FROM folders
      LEFT JOIN folder_shares ON folder_shares.folder_id = folders.id AND folder_shares.user_id = ?
      WHERE folders.id = ?
        AND (folders.user_id = ? OR folder_shares.user_id IS NOT NULL)
    `,
    )
    .get(userId, folderId, userId);
  return Boolean(folder);
}

export function userHasSharedFolderAccess(folderId: number, userId: number): boolean {
  const share = db.prepare("SELECT folder_id FROM folder_shares WHERE folder_id = ? AND user_id = ?").get(folderId, userId);
  return Boolean(share);
}

export function userCanReadBookmark(bookmarkId: number, userId: number): boolean {
  const bookmark = db
    .prepare(
      `
      SELECT bookmarks.id
      FROM bookmarks
      LEFT JOIN folder_shares ON folder_shares.folder_id = bookmarks.folder_id AND folder_shares.user_id = ?
      WHERE bookmarks.id = ?
        AND (bookmarks.user_id = ? OR folder_shares.user_id IS NOT NULL)
    `,
    )
    .get(userId, bookmarkId, userId);
  return Boolean(bookmark);
}

export function userHasSharedBookmarkAccess(bookmarkId: number, userId: number): boolean {
  const bookmark = db
    .prepare(
      `
      SELECT bookmarks.id
      FROM bookmarks
      INNER JOIN folder_shares ON folder_shares.folder_id = bookmarks.folder_id
      WHERE bookmarks.id = ?
        AND folder_shares.user_id = ?
        AND bookmarks.user_id != ?
    `,
    )
    .get(bookmarkId, userId, userId);
  return Boolean(bookmark);
}
