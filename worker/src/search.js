// 全站搜索：GET /search?q=关键词&in=all|reading|research&page=1
// 直接返回 HTML 页面（不是 JSON），不用 JavaScript，Kindle 等老浏览器也能用。
// 数据在 D1 的 search_docs 表，由 tools/search/build.py 生成后导入。中文按字匹配，用 LIKE 扫全表（几千行，很快）。
import { overLimit, sha256 } from './accounts.js';

const PER_PAGE = 20;
const MAX_ROWS = 600;
const QUERY_MAX = 40;
const SCOPES = { all: '全部', reading: '阅读园', research: '研究园' };
const KINDS = { book: '书', chapter: '章节', paper: '期刊文章' };

function esc(text) {
  return String(text ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

// 片段里把关键词加粗（不分大小写）
function mark(text, q) {
  const lower = text.toLowerCase(), needle = q.toLowerCase();
  let out = '', from = 0;
  for (let at = lower.indexOf(needle); at >= 0; at = lower.indexOf(needle, from)) {
    out += esc(text.slice(from, at)) + '<b>' + esc(text.slice(at, at + q.length)) + '</b>';
    from = at + q.length;
  }
  return out + esc(text.slice(from));
}

const STYLE = `<style>
body { margin: 0 auto; max-width: 760px; padding: 12px 16px 40px; background: #fff; color: #000;
  font: 18px/1.7 Georgia, "Songti SC", "STSong", SimSun, serif; }
a { color: #000; }
.nav { font-size: 16px; border-bottom: 1px solid #000; padding-bottom: 8px; }
.nav a { margin-right: 12px; }
h1 { font-size: 26px; margin: 14px 0 10px; }
form { margin: 0 0 14px; }
input[type=search] { width: 100%; box-sizing: border-box; font-size: 20px; padding: 8px; border: 2px solid #000; background: #fff; color: #000; }
.scopes { margin: 8px 0; font-size: 17px; }
.scopes label { margin-right: 14px; white-space: nowrap; }
button { font-size: 18px; padding: 6px 18px; border: 2px solid #000; background: #000; color: #fff; }
.note { font-size: 15px; color: #333; }
.hit { padding: 12px 0; border-bottom: 1px solid #000; }
.hit h2 { font-size: 19px; margin: 0; font-weight: normal; }
.meta { font-size: 14px; color: #333; margin: 2px 0; }
.tag { border: 1px solid #000; padding: 0 4px; margin-right: 6px; }
.snip { margin: 4px 0 0; font-size: 16px; overflow-wrap: anywhere; }
.pager { margin-top: 18px; font-size: 17px; }
.pager a { margin-right: 16px; }
</style>`;

function pageHtml({ q, scope, body, site }) {
  const scopes = Object.entries(SCOPES).map(([key, name]) =>
    `<label><input type="radio" name="in" value="${key}"${key === scope ? ' checked' : ''}> ${name}</label>`).join('');
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">
<title>${q ? `${esc(q)} · ` : ''}搜索 | gamesyuan</title>${STYLE}</head><body>
<p class="nav"><a href="${site}/">首页</a><a href="${site}/reading/">阅读园</a><a href="${site}/research/">研究园</a></p>
<h1>搜索</h1>
<form action="/search" method="get">
<input type="search" name="q" value="${esc(q)}" maxlength="${QUERY_MAX}" placeholder="书名、作者、正文里的词，比如 黛玉、Sherlock、causal" aria-label="搜索">
<p class="scopes">${scopes}</p>
<button type="submit">搜索</button>
</form>
${body}
</body></html>`;
}

export async function searchPage(request, env) {
  const url = new URL(request.url);
  const local = /^(localhost|127\.0\.0\.1)$/.test(url.hostname);
  const site = local ? 'http://localhost:5600' : 'https://gamesyuan.com';
  const q = (url.searchParams.get('q') || '').trim().slice(0, QUERY_MAX);
  const scope = SCOPES[url.searchParams.get('in')] ? url.searchParams.get('in') : 'all';
  const page = Math.max(1, Math.min(50, Number(url.searchParams.get('page')) || 1));
  const respond = (body, status = 200) => new Response(pageHtml({ q, scope, body, site }), {
    status, headers: { 'content-type': 'text/html; charset=utf-8', 'X-Robots-Tag': 'noindex', 'Cache-Control': 'public, max-age=300' },
  });

  if (!q) {
    return respond('<p class="note">可以搜阅读园里每本书的正文（中文书按简体搜），和研究园的期刊文章、经典书籍。'
      + '关键词越具体越好，比如人名、地名、术语。</p>');
  }
  const ip = request.headers.get('CF-Connecting-IP') || 'local';
  if (await overLimit(env, `search:${await sha256(ip)}`, 60, 60000)) {
    return respond('<p class="note">搜得太快了，歇一分钟再试。</p>', 429);
  }

  const like = '%' + q.replace(/[\\%_]/g, c => '\\' + c) + '%';
  const where = scope === 'all' ? '' : 'AND site = ?3';
  const { results } = await env.DB.prepare(
    `SELECT site, kind, title, sub, url, part,
       (length(body) - length(replace(lower(body), lower(?1), ''))) / length(?1) AS hits,
       substr(body, max(1, instr(lower(body), lower(?1)) - 45), 130) AS snip,
       instr(lower(body), lower(?1)) AS pos,
       title LIKE ?2 ESCAPE '\\' AS in_title
     FROM search_docs WHERE (body LIKE ?2 ESCAPE '\\' OR title LIKE ?2 ESCAPE '\\') ${where}
     LIMIT ${MAX_ROWS}`
  ).bind(q, like, ...(scope === 'all' ? [] : [scope])).all();

  // 同一章切成的几段合并成一条
  const byUrl = new Map();
  for (const row of results) {
    const item = byUrl.get(row.url);
    if (item) {
      item.hits += row.hits;
      if (!item.snip && row.pos) item.snip = row.snip;
    } else {
      byUrl.set(row.url, { ...row, snip: row.pos ? row.snip : '' });
    }
  }
  const order = { book: 0, paper: 1, chapter: 2 };
  const items = [...byUrl.values()].sort((a, b) =>
    b.in_title - a.in_title || order[a.kind] - order[b.kind] || b.hits - a.hits);
  const total = items.length;
  const shown = items.slice((page - 1) * PER_PAGE, page * PER_PAGE);
  if (!total) {
    return respond(`<p class="note">没有找到「${esc(q)}」。可以换个说法，或者少打几个字；中文书请用简体字搜。</p>`);
  }
  const link = path => (/^https?:/.test(path) ? path : site + path);
  const list = shown.map(item => `<div class="hit"><h2><a href="${esc(link(item.url))}">${mark(item.title, q)}</a></h2>
<p class="meta"><span class="tag">${SCOPES[item.site]} · ${KINDS[item.kind]}</span>${esc(item.sub)}${item.hits > 1 ? ` · 出现 ${item.hits} 次` : ''}</p>
${item.snip ? `<p class="snip">…${mark(item.snip, q)}…</p>` : ''}</div>`).join('\n');
  const more = results.length >= MAX_ROWS ? '（结果太多，只列出了一部分，换个更具体的词试试）' : '';
  const params = p => `/search?q=${encodeURIComponent(q)}&in=${scope}&page=${p}`;
  const pages = Math.ceil(total / PER_PAGE);
  const pager = pages > 1 ? `<p class="pager">${page > 1 ? `<a href="${params(page - 1)}">← 上一页</a>` : ''}第 ${page} / ${pages} 页${page < pages ? `　<a href="${params(page + 1)}">下一页 →</a>` : ''}</p>` : '';
  return respond(`<p class="note">找到 ${total} 处${more}</p>${list}${pager}`);
}
