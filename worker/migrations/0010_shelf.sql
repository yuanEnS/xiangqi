-- 研究园的书架：每个人给文章、书打星、标阅读状态、写一两句笔记。只有自己看得到。
-- item 是文章 id（DOI 或标题），书是 book:<id>。标题、期刊、日期、链接存一份，书架页不用再去下载整年的文章。
CREATE TABLE shelf (
  user_id INTEGER NOT NULL,
  item TEXT NOT NULL,
  title TEXT NOT NULL,
  journal TEXT NOT NULL DEFAULT '',
  date TEXT NOT NULL DEFAULT '',
  link TEXT NOT NULL DEFAULT '',
  starred INTEGER NOT NULL DEFAULT 0,
  status TEXT,                -- want 想读 / reading 在读 / done 读完 / NULL
  note TEXT NOT NULL DEFAULT '',
  done_at INTEGER,            -- 标成读完的时间（毫秒），一年读了多少篇按它算
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, item)
);
CREATE INDEX shelf_user ON shelf (user_id, updated_at DESC);
