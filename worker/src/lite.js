// 生活园的 Kindle 版：服务器直接生成网页，不用 JavaScript，老浏览器也能看公开的文章。
//   GET /life/lite                    世界园：最新的公开文章，分页
//   GET /life/lite/post?id=1          一篇文章（和公开的评论）
//   GET /life/lite/author?name=昵称    某位作者的全部公开文章
// 只放公开发布的文章；草稿、仅自己可见的文章、私人园地都不在这里。写文章、评论要用完整版。
import { OWNER_NAME } from './life.js';

const PER_PAGE = 30;
const VISIBLE = 'p.draft = 0 AND p.hidden = 0';
const AUTHOR = `COALESCE(u.name, '${OWNER_NAME}')`;
const RIGHTS = {
  credit: author => `本文为${author}原创，转载请注明作者和出处。`,
  ask: author => `本文为${author}原创，未经作者同意，请勿转载。`,
};

function esc(text) {
  return String(text ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

// ---------- 正文排版：和网页版 life.js 的 renderBody 一样的写法；公式显示原文（Kindle 加载不了排版公式的库） ----------
function safeUrl(url) {
  return /^(https?:\/\/|\/)/.test(url) ? url : '#';
}

function inline(text) {
  return esc(text)
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, url) => `<a href="${safeUrl(url)}" rel="noopener nofollow ugc">${label}</a>`)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
}

const MATH = '\u0000';
export function renderBody(source) {
  const formulas = [];
  const keep = (tex, display) => {
    formulas.push({ tex: tex.trim(), display });
    return `${MATH}${formulas.length - 1}${MATH}`;
  };
  const text = String(source || '')
    .replace(/\\\$/g, '\u0001')
    .replace(/\$\$([\s\S]+?)\$\$/g, (_, tex) => keep(tex, true))
    .replace(/\$(?!\s)([^$\n]+?)(?<!\s)\$(?!\d)/g, (_, tex) => keep(tex, false));
  const html = text.trim().split(/\n\s*\n/).map(block => {
    const lines = block.split('\n').map(line => line.trim()).filter(Boolean);
    const first = lines[0] || '';
    const image = first.match(/^!\[(.*?)\]\((\S+?)\)$/);
    if (first.startsWith('## ')) return `<h2>${inline(first.slice(3))}</h2>`;
    if (/^-{3,}$/.test(first)) return '<hr>';
    if (image) {
      const caption = image[1] ? `<p class="caption">${inline(image[1])}</p>` : '';
      return `<img src="${esc(safeUrl(image[2]))}" alt="${esc(image[1])}" referrerpolicy="no-referrer">${caption}`;
    }
    if (first.startsWith('>')) return `<blockquote><p>${lines.map(line => inline(line.replace(/^>\s*/, ''))).join('<br>')}</p></blockquote>`;
    return `<p>${lines.map(inline).join('<br>')}</p>`;
  }).join('\n');
  return html
    .replace(new RegExp(`${MATH}(\\d+)${MATH}`, 'g'), (_, i) => {
      const { tex, display } = formulas[i];
      return display ? `<pre class="math">${esc(tex)}</pre>` : `<code class="math">${esc(tex)}</code>`;
    })
    .replace(/\u0001/g, '$');
}

function excerpt(text, size = 80) {
  const block = String(text || '').split(/\n\s*\n/).map(b => b.trim()).find(b => b && !/^(##|>|!\[|-{3,})/.test(b)) || '';
  const plain = block.replace(/\\\$/g, '$').replace(/\$\$?([^$]+?)\$\$?/g, '$1').replace(/\*\*/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/\s+/g, '');
  return plain.length > size ? `${plain.slice(0, size)}…` : plain;
}

// ---------- 页面 ----------
const STYLE = `<style>
body { margin: 0 auto; max-width: 720px; padding: 12px 18px 40px; background: #fff; color: #000;
  font: 20px/1.85 "Songti SC", "STSong", "Noto Serif CJK SC", SimSun, Georgia, serif; }
a { color: #000; }
.nav { font-size: 16px; border-bottom: 1px solid #000; padding-bottom: 8px; }
.nav a { margin-right: 12px; }
.nav.bottom { border-top: 1px solid #000; border-bottom: 0; padding-top: 8px; margin-top: 32px; }
h1 { font-size: 28px; line-height: 1.4; margin: 18px 0 6px; }
h2 { font-size: 23px; line-height: 1.4; margin: 26px 0 10px; }
.meta { font-size: 15px; color: #333; margin: 0 0 18px; }
.item { padding: 12px 0; border-bottom: 1px solid #000; }
.item h2 { font-size: 20px; margin: 0; font-weight: normal; }
.item p { margin: 4px 0 0; font-size: 16px; }
.body p { margin: 0 0 1em; }
.body img { max-width: 100%; height: auto; display: block; margin: 12px auto; }
.caption { text-align: center; font-size: 15px; }
blockquote { margin: 14px 0; padding-left: 12px; border-left: 3px solid #000; }
pre.math, code.math { font: 15px/1.5 Menlo, Consolas, monospace; background: #eee; }
pre.math { padding: 8px; white-space: pre-wrap; overflow-wrap: anywhere; }
.rights { font-size: 15px; border-left: 3px solid #000; padding-left: 10px; margin-top: 24px; }
.comments { margin-top: 30px; border-top: 1px solid #000; padding-top: 6px; }
.comment { margin: 10px 0; font-size: 16px; }
.comment.reply { margin-left: 1.5em; }
.comment b { font-weight: bold; }
.pager { margin-top: 18px; font-size: 17px; }
.pager a { margin-right: 16px; }
.note { font-size: 15px; color: #333; }
form { margin: 10px 0 0; }
form input[type=search] { font-size: 18px; padding: 4px; width: 60%; }
form button { font-size: 18px; }
</style>`;

function shell({ title, body, site, canonical }) {
  const nav = `<p class="nav"><a href="/life/lite">世界园</a><a href="/search?in=life">搜索</a><a href="${site}/">首页</a>`
    + `${canonical ? `<a href="${esc(site + canonical)}">完整版</a>` : ''}</p>`;
  return new Response(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">
${canonical ? `<link rel="canonical" href="${esc(site + canonical)}">` : ''}
<title>${esc(title)} · 生活园简易版</title>${STYLE}</head><body>
${nav}${body}${nav.replace('class="nav"', 'class="nav bottom"')}
<p class="note">这是生活园的简易版，不用 JavaScript，Kindle 等老浏览器也能看。写文章、评论、看私人园地请用电脑或手机上的完整版。</p>
</body></html>`, { headers: { 'content-type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=120' } });
}

function postItem(post) {
  return `<div class="item"><h2><a href="/life/lite/post?id=${post.id}">${esc(post.title)}</a></h2>
<p><a href="/life/lite/author?name=${encodeURIComponent(post.author)}">${esc(post.author)}</a> · ${esc(post.date)}${post.tags ? ` · ${esc(post.tags)}` : ''}</p>
<p>${esc(excerpt(post.head))}</p></div>`;
}

function pager(base, page, total) {
  const pages = Math.ceil(total / PER_PAGE);
  if (pages <= 1) return '';
  const join = base.includes('?') ? '&' : '?';
  return `<p class="pager">${page > 1 ? `<a href="${base}${join}page=${page - 1}">← 上一页</a>` : ''}第 ${page} / ${pages} 页${page < pages ? `　<a href="${base}${join}page=${page + 1}">下一页 →</a>` : ''}</p>`;
}

const LIST = `SELECT p.id, p.title, p.tags, p.date, substr(p.body, 1, 400) AS head, ${AUTHOR} AS author
  FROM posts p LEFT JOIN users u ON u.id = p.author_id`;

async function worldList(env, page, site) {
  const [{ results }, count] = await Promise.all([
    env.DB.prepare(`${LIST} WHERE ${VISIBLE} ORDER BY p.date DESC, p.id DESC LIMIT ? OFFSET ?`).bind(PER_PAGE, (page - 1) * PER_PAGE).all(),
    env.DB.prepare(`SELECT COUNT(*) AS n FROM posts p WHERE ${VISIBLE}`).first(),
  ]);
  const search = '<form action="/search" method="get"><input type="search" name="q" placeholder="搜文章" aria-label="搜索">'
    + '<input type="hidden" name="in" value="life"> <button type="submit">搜索</button></form>';
  const body = `<h1>世界园</h1><p class="meta">世界各地作者的公开文章，新的在前，共 ${count.n} 篇。</p>${search}`
    + (results.length ? results.map(postItem).join('\n') : '<p>还没有文章。</p>') + pager('/life/lite', page, count.n);
  return shell({ title: '世界园', body, site, canonical: '/life/world/' });
}

async function authorList(env, name, page, site) {
  const where = name === OWNER_NAME ? 'p.author_id IS NULL' : 'u.name = ?';
  const binds = name === OWNER_NAME ? [] : [name];
  const [{ results }, count] = await Promise.all([
    env.DB.prepare(`${LIST} WHERE ${VISIBLE} AND ${where} ORDER BY p.date DESC, p.id DESC LIMIT ? OFFSET ?`)
      .bind(...binds, PER_PAGE, (page - 1) * PER_PAGE).all(),
    env.DB.prepare(`SELECT COUNT(*) AS n FROM posts p LEFT JOIN users u ON u.id = p.author_id WHERE ${VISIBLE} AND ${where}`).bind(...binds).first(),
  ]);
  if (!count.n) return shell({ title: '没有这位作者', body: `<h1>${esc(name)}</h1><p>这位作者还没有公开的文章。</p>`, site });
  const body = `<h1>${esc(name)}</h1><p class="meta">${count.n} 篇公开文章，新的在前。</p>`
    + results.map(postItem).join('\n') + pager(`/life/lite/author?name=${encodeURIComponent(name)}`, page, count.n);
  return shell({ title: name, body, site, canonical: `/life/personal/?author=${encodeURIComponent(name)}` });
}

async function postPage(env, id, site) {
  const post = await env.DB.prepare(
    `SELECT p.id, p.title, p.body, p.tags, p.date, p.rights, p.author_id, ${AUTHOR} AS author
     FROM posts p LEFT JOIN users u ON u.id = p.author_id WHERE p.id = ? AND ${VISIBLE}`
  ).bind(id).first();
  if (!post) return shell({ title: '文章不存在', body: '<h1>这篇文章不存在</h1><p>可能还没发布，或者作者设成了仅自己可见。</p>', site });
  const neighbour = (op, order) => env.DB.prepare(
    `SELECT id, title FROM posts p WHERE ${VISIBLE} AND author_id IS ? AND (date ${op} ? OR (date = ? AND id ${op} ?))
     ORDER BY date ${order}, id ${order} LIMIT 1`
  ).bind(post.author_id, post.date, post.date, post.id).first();
  const [newer, older, comments] = await Promise.all([
    neighbour('>', 'ASC'), neighbour('<', 'DESC'),
    env.DB.prepare(
      `SELECT c.id, c.parent_id, c.body, c.created_at, COALESCE(u.name, '已注销') AS author, r.name AS reply_name
       FROM comments c LEFT JOIN users u ON u.id = c.author_id LEFT JOIN users r ON r.id = c.reply_to
       WHERE c.post_id = ? AND c.status = 'shown' ORDER BY c.id LIMIT 500`
    ).bind(post.id).all().catch(() => ({ results: [] })),
  ]);
  const rights = RIGHTS[post.rights] ? `<p class="rights">${esc(RIGHTS[post.rights](post.author))}</p>` : '';
  const tops = comments.results.filter(c => !c.parent_id);
  const day = ms => new Date(ms + 8 * 3600000).toISOString().slice(0, 10);
  const commentHtml = tops.length ? `<section class="comments"><h2>评论 ${comments.results.length}</h2>${tops.map(top => {
    const replies = comments.results.filter(c => c.parent_id === top.id);
    const one = (c, reply) => `<div class="comment${reply ? ' reply' : ''}"><b>${esc(c.author)}</b>`
      + `${c.reply_name ? ` 回复 @${esc(c.reply_name)}` : ''} · ${day(c.created_at)}<br>${esc(c.body).replace(/\n/g, '<br>')}</div>`;
    return one(top, false) + replies.map(r => one(r, true)).join('');
  }).join('')}</section>` : '';
  const pagerHtml = (older || newer) ? `<p class="pager">${older ? `<a href="/life/lite/post?id=${older.id}">← 上一篇：${esc(older.title)}</a><br>` : ''}`
    + `${newer ? `<a href="/life/lite/post?id=${newer.id}">下一篇：${esc(newer.title)} →</a>` : ''}</p>` : '';
  const body = `<h1>${esc(post.title)}</h1>
<p class="meta"><a href="/life/lite/author?name=${encodeURIComponent(post.author)}">${esc(post.author)}</a> · ${esc(post.date)}${post.tags ? ` · ${esc(post.tags)}` : ''}</p>
<div class="body">${renderBody(post.body)}</div>${rights}${pagerHtml}${commentHtml}`;
  return shell({ title: post.title, body, site, canonical: `/life/post/?id=${post.id}` });
}

export async function litePage(request, env) {
  const url = new URL(request.url);
  const site = /^(localhost|127\.0\.0\.1)$/.test(url.hostname) ? 'http://localhost:5600' : 'https://gamesyuan.com';
  const page = Math.max(1, Math.min(1000, Number(url.searchParams.get('page')) || 1));
  const path = url.pathname.replace(/\/+$/, '');
  if (path === '/life/lite') return worldList(env, page, site);
  if (path === '/life/lite/post') return postPage(env, Number(url.searchParams.get('id')) || 0, site);
  if (path === '/life/lite/author') return authorList(env, String(url.searchParams.get('name') || '').slice(0, 40), page, site);
  return shell({ title: '找不到', body: '<h1>找不到这个页面</h1>', site });
}
