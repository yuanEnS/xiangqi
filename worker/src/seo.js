// 让 Google 能找到生活园的公开文章：api.gamesyuan.com/sitemap-life.xml 列出所有公开文章和作者页，
// gamesyuan.com/robots.txt 里写了这个地址。草稿、仅自己可见的文章、园地都不会出现在这里。
import { OWNER_NAME } from './life.js';

const SITE = 'https://gamesyuan.com';
const MAX_URLS = 45000; // 一个 sitemap 最多 50000 条

const xml = text => String(text).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]);
const day = ms => new Date(ms).toISOString().slice(0, 10);

export async function lifeSitemap(env) {
  const [posts, authors] = await Promise.all([
    env.DB.prepare(
      `SELECT id, updated_at FROM posts WHERE draft = 0 AND hidden = 0 ORDER BY date DESC, id DESC LIMIT ?`
    ).bind(MAX_URLS).all(),
    env.DB.prepare(
      `SELECT COALESCE(u.name, ?) AS name, MAX(p.updated_at) AS updated_at
       FROM posts p LEFT JOIN users u ON u.id = p.author_id
       WHERE p.draft = 0 AND p.hidden = 0 GROUP BY p.author_id LIMIT ?`
    ).bind(OWNER_NAME, MAX_URLS).all(),
  ]);
  const urls = [
    ...posts.results.map(p => [`${SITE}/life/post/?id=${p.id}`, p.updated_at]),
    ...authors.results.map(a => [`${SITE}/life/personal/?author=${encodeURIComponent(a.name)}`, a.updated_at]),
  ].slice(0, MAX_URLS);
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(([loc, updated]) => `  <url><loc>${xml(loc)}</loc><lastmod>${day(updated)}</lastmod></url>`).join('\n')}
</urlset>
`;
  return new Response(body, {
    headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600' },
  });
}

// api.gamesyuan.com 上的 robots.txt：允许抓取（网页渲染文章时要读接口），但接口本身带 noindex，不会进搜索结果
export function apiRobots() {
  return new Response(`User-agent: *\nAllow: /\n\nSitemap: https://api.gamesyuan.com/sitemap-life.xml\n`, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=86400' },
  });
}
