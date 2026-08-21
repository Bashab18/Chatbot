const Database = require("better-sqlite3");
const path = require("path");
const fs = require("fs");

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, "chatbot.db"));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id           TEXT PRIMARY KEY,
    email        TEXT UNIQUE NOT NULL,
    name         TEXT NOT NULL,
    role         TEXT NOT NULL DEFAULT 'user',
    password_hash TEXT NOT NULL,
    login_count  INTEGER NOT NULL DEFAULT 0,
    last_login   INTEGER,
    note         TEXT NOT NULL DEFAULT '',
    created_at   INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS conversations (
    id         TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL,
    title      TEXT NOT NULL DEFAULT 'New Chat',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS messages (
    id              TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    role            TEXT NOT NULL,
    text            TEXT NOT NULL,
    timestamp       INTEGER NOT NULL,
    FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS kb_documents (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    chunk_count INTEGER NOT NULL,
    added_at    INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS kb_chunks (
    rowid      INTEGER PRIMARY KEY AUTOINCREMENT,
    doc_id     TEXT NOT NULL,
    doc_name   TEXT NOT NULL,
    text       TEXT NOT NULL,
    embedding  TEXT NOT NULL,
    FOREIGN KEY (doc_id) REFERENCES kb_documents(id) ON DELETE CASCADE
  );

  -- Nudges sent to the mHealth app, either an admin from the Admin Panel
  -- or CIRA itself deciding on its own (created_by = 'cira-auto', see
  -- checkAndSendProactiveNudges) -- the app polls GET
  -- /api/user/nudges/pending and shows them as local notifications, since
  -- this server has no way to push to a phone that isn't listening.
  -- "Send to all" fans out to one row per recipient at creation time (not
  -- a shared NULL-user_id row) so each user's delivered_at is independent.
  CREATE TABLE IF NOT EXISTS nudges (
    id           TEXT PRIMARY KEY,
    user_id      TEXT NOT NULL,
    title        TEXT NOT NULL,
    body         TEXT NOT NULL,
    created_at   INTEGER NOT NULL,
    created_by   TEXT,
    delivered_at INTEGER,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_nudges_user_pending ON nudges(user_id, delivered_at);
`);

// ── Migrations ────────────────────────────────────────────────────────────────
// Safe: throws on duplicate column, which we silently ignore
try { db.exec("ALTER TABLE users ADD COLUMN profile TEXT NOT NULL DEFAULT '{}'"); } catch (_) {}
try { db.exec("ALTER TABLE messages ADD COLUMN refs TEXT"); } catch (_) {}
try { db.exec("ALTER TABLE users ADD COLUMN memories TEXT NOT NULL DEFAULT '[]'"); } catch (_) {}

module.exports = db;
