-- Phase 3: Wordbank + Community + Dungeon
-- 既存local-first方針を維持しつつ、クラウド辞書/ゲーム機能を追加

-- usage_daily拡張（校正トークン計算用）
ALTER TABLE usage_daily ADD COLUMN minutes_today INTEGER NOT NULL DEFAULT 0;
ALTER TABLE usage_daily ADD COLUMN proofread_tokens_today INTEGER NOT NULL DEFAULT 1;
ALTER TABLE usage_daily ADD COLUMN proofread_used_today INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS core_words (
  word_id TEXT PRIMARY KEY,
  headword TEXT NOT NULL,
  headword_norm TEXT NOT NULL UNIQUE,
  meaning_ja_short TEXT NOT NULL,
  pos TEXT,
  level TEXT,
  tags_json TEXT,
  source TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK (length(meaning_ja_short) <= 80),
  CHECK (meaning_ja_short NOT LIKE '%\n%'),
  CHECK (meaning_ja_short NOT LIKE '%\r%')
);

CREATE INDEX IF NOT EXISTS idx_core_words_updated ON core_words(updated_at DESC);

CREATE TABLE IF NOT EXISTS core_decks (
  deck_id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  source TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS core_deck_words (
  deck_id TEXT NOT NULL REFERENCES core_decks(deck_id) ON DELETE CASCADE,
  word_id TEXT NOT NULL REFERENCES core_words(word_id) ON DELETE CASCADE,
  order_index INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (deck_id, word_id)
);

CREATE INDEX IF NOT EXISTS idx_core_deck_words_deck_order
ON core_deck_words(deck_id, order_index);

CREATE TABLE IF NOT EXISTS user_profiles (
  user_id TEXT PRIMARY KEY REFERENCES users(user_id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS user_roles (
  user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  granted_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, role),
  CHECK (role IN ('contributor', 'proofreader', 'editor', 'maintainer'))
);

CREATE INDEX IF NOT EXISTS idx_user_roles_user_granted
ON user_roles(user_id, granted_at DESC);

CREATE TABLE IF NOT EXISTS ugc_changesets (
  changeset_id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  created_by TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  merged_at INTEGER,
  CHECK (status IN ('draft', 'proposed', 'approved', 'merged', 'closed'))
);

CREATE INDEX IF NOT EXISTS idx_ugc_changesets_status_updated
ON ugc_changesets(status, updated_at DESC);

CREATE TABLE IF NOT EXISTS ugc_changeset_items (
  item_id TEXT PRIMARY KEY,
  changeset_id TEXT NOT NULL REFERENCES ugc_changesets(changeset_id) ON DELETE CASCADE,
  headword_norm TEXT NOT NULL,
  patch_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ugc_changeset_items_changeset
ON ugc_changeset_items(changeset_id, created_at ASC);

CREATE TABLE IF NOT EXISTS ugc_reviews (
  review_id TEXT PRIMARY KEY,
  changeset_id TEXT NOT NULL REFERENCES ugc_changesets(changeset_id) ON DELETE CASCADE,
  reviewer_user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  comment TEXT,
  created_at INTEGER NOT NULL,
  CHECK (action IN ('approve', 'request_changes', 'comment')),
  CHECK (comment IS NULL OR length(comment) <= 200),
  CHECK (comment IS NULL OR comment NOT LIKE '%\n%'),
  CHECK (comment IS NULL OR comment NOT LIKE '%\r%')
);

CREATE INDEX IF NOT EXISTS idx_ugc_reviews_changeset
ON ugc_reviews(changeset_id, created_at ASC);

CREATE TABLE IF NOT EXISTS ugc_lexeme_canonical (
  headword_norm TEXT PRIMARY KEY,
  meaning_ja_short TEXT NOT NULL,
  example_en_short TEXT,
  note_short TEXT,
  source TEXT NOT NULL DEFAULT 'community',
  version_int INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL,
  updated_by TEXT REFERENCES users(user_id),
  CHECK (length(meaning_ja_short) <= 80),
  CHECK (meaning_ja_short NOT LIKE '%\n%'),
  CHECK (meaning_ja_short NOT LIKE '%\r%'),
  CHECK (example_en_short IS NULL OR length(example_en_short) <= 160),
  CHECK (example_en_short IS NULL OR example_en_short NOT LIKE '%\n%'),
  CHECK (example_en_short IS NULL OR example_en_short NOT LIKE '%\r%'),
  CHECK (note_short IS NULL OR length(note_short) <= 160),
  CHECK (note_short IS NULL OR note_short NOT LIKE '%\n%'),
  CHECK (note_short IS NULL OR note_short NOT LIKE '%\r%')
);

CREATE TABLE IF NOT EXISTS ugc_lexeme_history (
  history_id INTEGER PRIMARY KEY AUTOINCREMENT,
  headword_norm TEXT NOT NULL,
  version_int INTEGER NOT NULL,
  snapshot_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  created_by TEXT REFERENCES users(user_id),
  changeset_id TEXT REFERENCES ugc_changesets(changeset_id)
);

CREATE INDEX IF NOT EXISTS idx_ugc_lexeme_history_headword
ON ugc_lexeme_history(headword_norm, version_int DESC);

CREATE TABLE IF NOT EXISTS game_dungeons_daily (
  date TEXT PRIMARY KEY,
  dungeon_id TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  description TEXT
);

CREATE TABLE IF NOT EXISTS game_dungeon_tasks (
  task_id TEXT PRIMARY KEY,
  dungeon_id TEXT NOT NULL REFERENCES game_dungeons_daily(dungeon_id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  headword_norm TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  assigned_to TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  updated_at INTEGER,
  CHECK (type IN ('proofread', 'propose')),
  CHECK (status IN ('pending', 'done'))
);

CREATE INDEX IF NOT EXISTS idx_game_dungeon_tasks_dungeon
ON game_dungeon_tasks(dungeon_id, created_at ASC);

CREATE TABLE IF NOT EXISTS user_dungeon_progress (
  user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  dungeon_id TEXT NOT NULL REFERENCES game_dungeons_daily(dungeon_id) ON DELETE CASCADE,
  cleared_count INTEGER NOT NULL DEFAULT 0,
  reward_claimed INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, date, dungeon_id)
);

