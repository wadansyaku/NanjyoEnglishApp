-- Phase 10: passkey authentication (WebAuthn)

CREATE TABLE IF NOT EXISTS auth_passkeys (
  credential_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  public_key TEXT NOT NULL,
  algorithm TEXT NOT NULL,
  transports_json TEXT NOT NULL DEFAULT '[]',
  counter INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_auth_passkeys_user
ON auth_passkeys(user_id);

CREATE TABLE IF NOT EXISTS auth_passkey_challenges (
  challenge_id TEXT PRIMARY KEY,
  challenge TEXT NOT NULL,
  purpose TEXT NOT NULL CHECK (purpose IN ('register', 'login')),
  user_id TEXT,
  display_name TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_auth_passkey_challenges_expires
ON auth_passkey_challenges(expires_at, used_at);
