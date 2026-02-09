CREATE TABLE IF NOT EXISTS admin_global_settings (
  setting_key TEXT PRIMARY KEY,
  settings_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  updated_by TEXT
);

