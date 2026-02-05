CREATE TABLE IF NOT EXISTS feedback (
  feedback_id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,
  message TEXT NOT NULL,
  context_json TEXT,
  created_at INTEGER NOT NULL,
  created_by TEXT,
  CHECK (type IN ('ocr', 'ux', 'bug', 'feature')),
  CHECK (length(message) <= 200),
  CHECK (message NOT LIKE '%\n%'),
  CHECK (message NOT LIKE '%\r%'),
  CHECK (context_json IS NULL OR length(context_json) <= 2000)
);

CREATE INDEX IF NOT EXISTS idx_feedback_created_at ON feedback(created_at);
CREATE INDEX IF NOT EXISTS idx_feedback_created_by ON feedback(created_by);
