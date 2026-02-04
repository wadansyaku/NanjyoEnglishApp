CREATE TABLE IF NOT EXISTS users (
  user_id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  avatar_seed TEXT,
  api_key_hash TEXT,
  xp_total INTEGER NOT NULL DEFAULT 0,
  level INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS lexemes (
  lexeme_id INTEGER PRIMARY KEY AUTOINCREMENT,
  headword TEXT NOT NULL,
  headword_norm TEXT NOT NULL UNIQUE,
  lemma TEXT,
  pos TEXT,
  created_at INTEGER NOT NULL,
  created_by TEXT,
  FOREIGN KEY (created_by) REFERENCES users(user_id)
);

CREATE TABLE IF NOT EXISTS lexeme_entries (
  entry_id INTEGER PRIMARY KEY AUTOINCREMENT,
  lexeme_id INTEGER NOT NULL,
  scope_type TEXT NOT NULL DEFAULT 'public',
  meaning_ja TEXT,
  example_en TEXT,
  note TEXT,
  created_at INTEGER NOT NULL,
  created_by TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  FOREIGN KEY (lexeme_id) REFERENCES lexemes(lexeme_id),
  FOREIGN KEY (created_by) REFERENCES users(user_id),
  CHECK (scope_type = 'public')
);

CREATE INDEX IF NOT EXISTS idx_lexemes_headword_norm ON lexemes(headword_norm);
CREATE INDEX IF NOT EXISTS idx_lexeme_entries_lexeme_id ON lexeme_entries(lexeme_id);
