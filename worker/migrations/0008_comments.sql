-- 公开文章下的评论，只有文字，只嵌套一层。
-- parent_id：回复的是哪条顶层评论，顶层评论为空。reply_to：回复楼中楼时，被回复的人（显示「回复 @某某」）。
-- status：shown 公开，pending 等审核（只有作者本人和审核的人看得到），deleted 已删除。
-- 删掉的评论正文保留 90 天再清空，遇到纠纷时有据可查；deleted_by 是谁删的。
CREATE TABLE comments (
  id INTEGER PRIMARY KEY,
  post_id INTEGER NOT NULL,
  author_id INTEGER NOT NULL,
  parent_id INTEGER,
  reply_to INTEGER,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'shown',
  reports INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  deleted_by INTEGER,
  deleted_at INTEGER
);
CREATE INDEX comments_post ON comments (post_id, id);
CREATE INDEX comments_author ON comments (author_id, created_at);
CREATE INDEX comments_status ON comments (status, id);
CREATE INDEX comments_reply ON comments (reply_to, id);

-- 每人每条只能举报一次
CREATE TABLE comment_reports (
  comment_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (comment_id, user_id)
);

-- 被园主禁止评论的账号
CREATE TABLE comment_bans (
  user_id INTEGER PRIMARY KEY,
  created_at INTEGER NOT NULL
);

-- 网站的开关，比如评论审核方式 comment_review：all 全部先审 / first 第一次先审 / off 不审
CREATE TABLE site_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- 作者可以关掉自己某篇文章的评论
ALTER TABLE posts ADD COLUMN comments_off INTEGER NOT NULL DEFAULT 0;
-- 评论消息看到了哪一条（评论 id），比它新的算未读
ALTER TABLE users ADD COLUMN comments_seen INTEGER NOT NULL DEFAULT 0;
