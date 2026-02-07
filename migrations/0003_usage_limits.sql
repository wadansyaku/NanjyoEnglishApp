CREATE TABLE IF NOT EXISTS usage_daily (
  user_id TEXT NOT NULL,
  usage_date TEXT NOT NULL,
  cloud_ocr_calls_today INTEGER NOT NULL DEFAULT 0,
  ai_meaning_calls_today INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, usage_date),
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);
