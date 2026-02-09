-- User-scoped garden tasks:
-- keep daily task templates in game_dungeon_tasks,
-- track each learner's completion/attempts independently.

CREATE TABLE IF NOT EXISTS game_user_dungeon_tasks (
  user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  task_id TEXT NOT NULL REFERENCES game_dungeon_tasks(task_id) ON DELETE CASCADE,
  dungeon_id TEXT NOT NULL REFERENCES game_dungeons_daily(dungeon_id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  last_answer_correct INTEGER,
  solved_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, task_id),
  CHECK (status IN ('pending', 'done')),
  CHECK (last_answer_correct IS NULL OR last_answer_correct IN (0, 1))
);

CREATE INDEX IF NOT EXISTS idx_game_user_dungeon_tasks_user_dungeon
ON game_user_dungeon_tasks(user_id, dungeon_id, status, updated_at DESC);
