-- 已发布但只给作者自己看的文章。和草稿一样不进公开列表和地图，但算写完了，占当天的发布名额
ALTER TABLE posts ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0;
