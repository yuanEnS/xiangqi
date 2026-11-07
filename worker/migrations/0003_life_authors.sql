-- 生活园开放给所有正式账号。author_id 为空的是开放之前写的，属于园主。
ALTER TABLE posts ADD COLUMN author_id INTEGER;
-- 这篇是否已经占过当天的发布名额，改成草稿再发布不再占
ALTER TABLE posts ADD COLUMN counted INTEGER NOT NULL DEFAULT 0;
UPDATE posts SET counted = 1 WHERE draft = 0;
CREATE INDEX posts_author ON posts (author_id, draft);

-- 每人每天一篇。单独记录，删掉文章也不会多出名额
CREATE TABLE life_days (
  user_id INTEGER NOT NULL,
  day TEXT NOT NULL,
  PRIMARY KEY (user_id, day)
);

-- 作者在地图上的大致位置，只存取整到半度的坐标（约 50 公里）和国家代码
CREATE TABLE life_places (
  user_id INTEGER PRIMARY KEY,
  lat REAL NOT NULL,
  lon REAL NOT NULL,
  country TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX life_places_cell ON life_places (lat, lon);
