-- Cloudflare D1 スキーマ
-- NanjyoEnglishApp ユーザーデータ同期用

-- ユーザーテーブル
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE,
  display_name TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  last_login_at INTEGER
);

-- ユーザー進捗テーブル（XP・レベル・ストリーク）
CREATE TABLE IF NOT EXISTS user_progress (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  xp_total INTEGER NOT NULL DEFAULT 0,
  level INTEGER NOT NULL DEFAULT 1,
  streak_days INTEGER NOT NULL DEFAULT 0,
  last_activity_at INTEGER
);

-- デッキテーブル
CREATE TABLE IF NOT EXISTS user_decks (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  title TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  synced_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_user_decks_user ON user_decks(user_id);

-- カードテーブル
CREATE TABLE IF NOT EXISTS user_cards (
  id TEXT PRIMARY KEY,
  deck_id TEXT NOT NULL REFERENCES user_decks(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  headword_norm TEXT NOT NULL,
  headword TEXT NOT NULL,
  meaning_ja TEXT,
  -- SRS状態
  due_at INTEGER NOT NULL,
  interval INTEGER NOT NULL DEFAULT 0,
  ease REAL NOT NULL DEFAULT 2.5,
  lapses INTEGER NOT NULL DEFAULT 0,
  reps INTEGER NOT NULL DEFAULT 0,
  last_reviewed_at INTEGER,
  -- 同期メタ
  synced_at INTEGER,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

CREATE INDEX IF NOT EXISTS idx_user_cards_user ON user_cards(user_id);
CREATE INDEX IF NOT EXISTS idx_user_cards_deck ON user_cards(deck_id);
CREATE INDEX IF NOT EXISTS idx_user_cards_due ON user_cards(user_id, due_at);

-- マジックリンク認証用
CREATE TABLE IF NOT EXISTS auth_tokens (
  token TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_auth_tokens_email ON auth_tokens(email);

-- イベントログ（アナリティクス）
CREATE TABLE IF NOT EXISTS event_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT REFERENCES users(id),
  event_name TEXT NOT NULL,
  event_data TEXT, -- JSON
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

CREATE INDEX IF NOT EXISTS idx_event_logs_user ON event_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_event_logs_name ON event_logs(event_name);
