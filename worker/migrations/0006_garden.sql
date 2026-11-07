-- 私人园里的园地：心愿单（wish）、旅行地图（travel）、纪念日（dates）
CREATE TABLE gardens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id INTEGER NOT NULL,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  intro TEXT NOT NULL DEFAULT '',
  public INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX gardens_owner ON gardens (owner_id);

-- 受邀一起写的人。joined = 0 是还没答应
CREATE TABLE garden_members (
  garden_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  joined INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (garden_id, user_id)
);
CREATE INDEX garden_members_user ON garden_members (user_id);

-- 条目：心愿、去过的地方、纪念日。用不到的列留空
CREATE TABLE garden_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  garden_id INTEGER NOT NULL,
  author_id INTEGER,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  date TEXT NOT NULL DEFAULT '',
  lat REAL,
  lon REAL,
  done INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX garden_items_garden ON garden_items (garden_id);
CREATE INDEX garden_items_author ON garden_items (author_id);
