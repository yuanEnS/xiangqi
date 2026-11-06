// 园中小记的文章接口。只有 LIFE_ADMIN_EMAIL_HASH 对应的账号能写，其他人只能读已发布的文章。
//   GET  /api/life/posts                已发布文章列表
//   GET  /api/life/post?id=1            一篇文章和前后篇（草稿只有作者能看）
//   GET  /api/life/admin                全部文章，含草稿
//   POST /api/life/save {id?, title, date, tags, body, draft}
//   POST /api/life/delete {id}
import { ApiError, sha256 } from './accounts.js';

const TITLE_MAX = 100;
const TAGS_MAX = 100;
const BODY_MAX = 100000;
const LIST_MAX = 1000;
const NEWEST_FIRST = 'ORDER BY date DESC, id DESC';
const SUMMARY = 'id, title, tags, date, draft, substr(body, 1, 300) AS head';

async function isAdmin(env, user) {
  return !!(user && user.email && env.LIFE_ADMIN_EMAIL_HASH
    && await sha256(user.email) === env.LIFE_ADMIN_EMAIL_HASH);
}

function validDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

async function list(env, where) {
  const { results } = await env.DB.prepare(`SELECT ${SUMMARY} FROM posts ${where} ${NEWEST_FIRST} LIMIT ?`)
    .bind(LIST_MAX).all();
  return { list: results };
}

async function read(env, id, admin) {
  const post = await env.DB.prepare('SELECT id, title, body, tags, date, draft FROM posts WHERE id = ?').bind(id).first();
  if (!post || (post.draft && !admin)) throw new ApiError(404, '这篇文章不存在');
  const neighbour = (op, order) => env.DB.prepare(
    `SELECT id, title FROM posts WHERE draft = 0 AND (date ${op} ? OR (date = ? AND id ${op} ?))
     ORDER BY date ${order}, id ${order} LIMIT 1`
  ).bind(post.date, post.date, post.id).first();
  const [newer, older] = await Promise.all([neighbour('>', 'ASC'), neighbour('<', 'DESC')]);
  return { post, newer, older };
}

async function save(env, body) {
  const title = String(body.title || '').trim();
  const text = String(body.body || '').trim();
  const tags = String(body.tags || '').trim();
  const date = String(body.date || '');
  const draft = body.draft ? 1 : 0;
  if (!title || title.length > TITLE_MAX) throw new ApiError(400, `标题要 1 到 ${TITLE_MAX} 个字`);
  if (!text || text.length > BODY_MAX) throw new ApiError(400, '正文不能为空，也不能超过 10 万字');
  if (tags.length > TAGS_MAX) throw new ApiError(400, '标签太长了');
  if (!validDate(date)) throw new ApiError(400, '日期不对');

  const now = Date.now();
  if (body.id) {
    const row = await env.DB.prepare(
      'UPDATE posts SET title = ?, body = ?, tags = ?, date = ?, draft = ?, updated_at = ? WHERE id = ? RETURNING id'
    ).bind(title, text, tags, date, draft, now, body.id).first();
    if (!row) throw new ApiError(404, '这篇文章不存在');
    return { id: row.id };
  }
  const row = await env.DB.prepare(
    'INSERT INTO posts (title, body, tags, date, draft, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id'
  ).bind(title, text, tags, date, draft, now, now).first();
  return { id: row.id };
}

export async function lifeRoute(env, key, url, body, user) {
  const admin = await isAdmin(env, user);
  const needAdmin = () => {
    if (!user) throw new ApiError(401, '请先登录');
    if (!admin) throw new ApiError(403, '只有作者能写文章');
  };
  switch (key) {
    case 'GET /api/life/posts':
      return list(env, 'WHERE draft = 0');
    case 'GET /api/life/post':
      return read(env, Number(url.searchParams.get('id')), admin);
    case 'GET /api/life/admin':
      needAdmin();
      return list(env, '');
    case 'POST /api/life/save':
      needAdmin();
      return save(env, body);
    case 'POST /api/life/delete':
      needAdmin();
      await env.DB.prepare('DELETE FROM posts WHERE id = ?').bind(body.id).run();
      return { ok: true };
  }
  throw new ApiError(404, '接口不存在');
}
