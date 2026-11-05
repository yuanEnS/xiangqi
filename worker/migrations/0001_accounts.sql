-- 账号以验证过的邮箱为准：Google 登录和邮箱验证码登录同一个邮箱，就是同一个账号。
-- email 为空的是游客账号。
CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  email TEXT UNIQUE,
  created_at INTEGER NOT NULL
);

-- 只存令牌的哈希，数据库泄露也拿不到能用的令牌
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX sessions_user ON sessions (user_id);

CREATE TABLE ratings (
  user_id INTEGER NOT NULL,
  game TEXT NOT NULL,
  rating INTEGER NOT NULL,
  games INTEGER NOT NULL,
  wins INTEGER NOT NULL,
  losses INTEGER NOT NULL,
  draws INTEGER NOT NULL,
  PRIMARY KEY (user_id, game)
);
CREATE INDEX ratings_rank ON ratings (game, rating DESC);

-- 计分的对局，同时用来限制同一对手每天的计分局数
CREATE TABLE matches (
  id INTEGER PRIMARY KEY,
  game TEXT NOT NULL,
  first_id INTEGER NOT NULL,
  second_id INTEGER NOT NULL,
  winner TEXT NOT NULL,
  reason TEXT,
  moves INTEGER NOT NULL,
  first_delta INTEGER NOT NULL,
  second_delta INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX matches_time ON matches (created_at);

CREATE TABLE email_codes (
  email TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL,
  sent_at INTEGER NOT NULL
);

CREATE TABLE rate_limits (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  reset_at INTEGER NOT NULL
);
