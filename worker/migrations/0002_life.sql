-- 园中小记（gamesyuan.com/life/）的文章。body 是简单标记的纯文本，在网页上排版。
CREATE TABLE posts (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  tags TEXT NOT NULL DEFAULT '',
  date TEXT NOT NULL,
  draft INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX posts_list ON posts (draft, date DESC, id DESC);

INSERT INTO posts (id, title, tags, date, draft, created_at, updated_at, body) VALUES (
  1, '在这里开一小块园子', '随笔', '2026-11-06', 0, 1793980800000, 1793980800000,
'这个网站原本只是为了下棋。先有了象棋，后来添了五子棋，再后来又有了账号和排行榜。每做完一样，就想着下一样，一路往前赶，很少停下来。

今天忽然想到，园子里除了棋盘，也可以留一块空地。不放游戏，不算积分，只用来写字。

## 记些什么

大概都是日常里的小事：今天吃到的一碗面，路上看见的一棵树，读到一半放下的书，或者写代码时怎么也绕不出来、第二天早上却忽然想通的那个问题。

这些事都不重要，可是不写下来，过几个月就什么也记不得了。

> 写给以后的自己，也写给偶尔路过这里的人。

## 怎么写

不求写得好，也不求写得勤。有话就写，没话就空着。一句话也算一篇，长一点也无妨。

下棋讲究落子无悔，写字倒不必，写错了改就是了。

今天先写到这里。地算是开出来了，往后慢慢种。'
);
