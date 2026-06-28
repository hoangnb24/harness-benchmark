import Database from "better-sqlite3";

const databasePath = process.env.DATABASE_PATH ?? "data.db";
const db: Database.Database = new Database(databasePath);

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

export function initializeDatabase(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS folders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER REFERENCES users(id),
      name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS bookmarks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER REFERENCES users(id),
      url TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      folder_id INTEGER REFERENCES folders(id),
      version INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(user_id, name)
    );

    CREATE TABLE IF NOT EXISTS bookmark_tags (
      bookmark_id INTEGER NOT NULL REFERENCES bookmarks(id) ON DELETE CASCADE,
      tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
      PRIMARY KEY (bookmark_id, tag_id)
    );

    CREATE TABLE IF NOT EXISTS folder_shares (
      folder_id INTEGER NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL,
      PRIMARY KEY (folder_id, user_id)
    )
  `);

  const bookmarkColumns = db.prepare("PRAGMA table_info(bookmarks)").all() as Array<{ name: string }>;
  const hasFolderId = bookmarkColumns.some((column) => column.name === "folder_id");

  if (!hasFolderId) {
    db.exec("ALTER TABLE bookmarks ADD COLUMN folder_id INTEGER REFERENCES folders(id)");
  }

  const hasBookmarkUserId = bookmarkColumns.some((column) => column.name === "user_id");

  if (!hasBookmarkUserId) {
    db.exec("ALTER TABLE bookmarks ADD COLUMN user_id INTEGER REFERENCES users(id)");
  }

  const hasBookmarkVersion = bookmarkColumns.some((column) => column.name === "version");

  if (!hasBookmarkVersion) {
    db.exec("ALTER TABLE bookmarks ADD COLUMN version INTEGER NOT NULL DEFAULT 1");
  }

  const folderColumns = db.prepare("PRAGMA table_info(folders)").all() as Array<{ name: string }>;
  const hasFolderUserId = folderColumns.some((column) => column.name === "user_id");

  if (!hasFolderUserId) {
    db.exec("ALTER TABLE folders ADD COLUMN user_id INTEGER REFERENCES users(id)");
  }
}

initializeDatabase();

export { db };
