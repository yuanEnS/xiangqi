-- 纪念日提醒可以多选（当天、提前 3 天、提前 7 天……）：每个提醒日一行。
-- 主键加上 days；原来设好的提醒原样保留。last_sent 是这个提醒日已经提醒过的那一次的日期
CREATE TABLE date_reminders_multi (
  user_id INTEGER NOT NULL,
  item_id INTEGER NOT NULL,
  days INTEGER NOT NULL,
  last_sent TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, item_id, days)
);
INSERT INTO date_reminders_multi (user_id, item_id, days, last_sent, created_at)
  SELECT user_id, item_id, days, last_sent, created_at FROM date_reminders;
DROP TABLE date_reminders;
ALTER TABLE date_reminders_multi RENAME TO date_reminders;
CREATE INDEX date_reminders_item ON date_reminders (item_id);
