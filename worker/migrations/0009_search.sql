-- 全站搜索：阅读园、研究园的内容，由 tools/search/build.py 生成的 SQL 整批导入（每次先清空）。
-- 长章节切成几段（part），搜索时按 url 合并。中文按字匹配，所以用 LIKE 扫全表，不建全文索引。
CREATE TABLE search_docs (
  id INTEGER PRIMARY KEY,
  site TEXT NOT NULL,     -- reading / research
  kind TEXT NOT NULL,     -- book / chapter / paper
  title TEXT NOT NULL,
  sub TEXT NOT NULL DEFAULT '',
  url TEXT NOT NULL,
  body TEXT NOT NULL,
  part INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX search_docs_site ON search_docs (site);
