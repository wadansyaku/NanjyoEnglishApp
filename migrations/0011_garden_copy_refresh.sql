-- Align existing daily dungeon copy with the garden cultivation concept.
UPDATE game_dungeons_daily
SET title = '今日のお庭'
WHERE title IS NULL OR title = '' OR title = '今日の冒険';

UPDATE game_dungeons_daily
SET description = 'ことばの芽をお世話して、収穫ノートを解放しよう'
WHERE description IS NULL
   OR description = ''
   OR description = '校正タスクをこなして単語デッキを解放しよう';
