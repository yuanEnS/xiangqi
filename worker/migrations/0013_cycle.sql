-- 私人园的「经期记录」园地：每天一行（来没来、多少、症状、一句话），只有主人自己看得到。
CREATE TABLE cycle_days (
  garden_id INTEGER NOT NULL,
  date TEXT NOT NULL,
  flow INTEGER NOT NULL DEFAULT 0,      -- 0 没来、1 少、2 中、3 多
  symptoms TEXT NOT NULL DEFAULT '',    -- 逗号分开的代码，见 server/cycle.js 的 SYMPTOMS
  note TEXT NOT NULL DEFAULT '',
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (garden_id, date)
);
-- 预计下次月经前几天发邮件提醒（可以多选），last_sent 是已经提醒过的那一次的预计日期
CREATE TABLE cycle_reminders (
  garden_id INTEGER NOT NULL,
  days INTEGER NOT NULL,
  last_sent TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (garden_id, days)
);
