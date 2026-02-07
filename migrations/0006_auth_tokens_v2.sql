-- Phase 4: auth_tokens互換修正
-- 旧schema(token) -> 新schema(token_hash + purpose + target_user_id)
-- 既存トークンは短命のため引き継がず再発行前提にする

DROP TABLE IF EXISTS auth_tokens;

CREATE TABLE IF NOT EXISTS auth_tokens (
  token_hash TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  purpose TEXT NOT NULL DEFAULT 'signin',
  target_user_id TEXT,
  expires_at INTEGER NOT NULL,
  used_at INTEGER,
  created_at INTEGER NOT NULL,
  CHECK (purpose IN ('signin', 'link'))
);

CREATE INDEX IF NOT EXISTS idx_auth_tokens_email ON auth_tokens(email);
CREATE INDEX IF NOT EXISTS idx_auth_tokens_expires ON auth_tokens(expires_at);

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_unique
ON users(email)
WHERE email IS NOT NULL;

