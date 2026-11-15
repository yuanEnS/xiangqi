-- 纪念日园地：每一条可以是纪念日或生日，可以按农历过；每个人可以给某一条设邮件提醒（提前几天）。
-- 农历的那一条，date 存当初那天的阳历日期，农历的月、日由它换算出来（server/lunar.js）。
ALTER TABLE garden_items ADD COLUMN date_type TEXT NOT NULL DEFAULT 'anniversary'; -- anniversary 纪念日 / birthday 生日
ALTER TABLE garden_items ADD COLUMN lunar INTEGER NOT NULL DEFAULT 0;               -- 1 = 按农历过

-- 谁要提前几天收到邮件。last_sent 是已经提醒过的那一次的日期，同一次只发一封
CREATE TABLE date_reminders (
  user_id INTEGER NOT NULL,
  item_id INTEGER NOT NULL,
  days INTEGER NOT NULL,
  last_sent TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, item_id)
);
CREATE INDEX date_reminders_item ON date_reminders (item_id);
