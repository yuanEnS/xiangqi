// 生活园的文章接口。有邮箱的正式账号都能写，每天发布一篇；LIFE_ADMIN_EMAIL_HASH 对应的园主
// 还能修改、删除别人已发布的文章，用来处理不合适的内容。
//   GET  /api/life/posts?author=昵称     已发布文章列表，不带 author 是所有人的
//   GET  /api/life/post?id=1            一篇文章和前后篇（草稿只有作者能看）
//   GET  /api/life/map                  地图：各地作者数，和随机挑出的作者
//   GET  /api/life/mine                 自己的全部文章，含草稿，和今天的发布名额
//   POST /api/life/save {id?, title, date, tags, body, draft, place, rights, public}
// 草稿和不公开的文章只有作者自己能看，园主也看不到
//   POST /api/life/delete {id}
import { ApiError, sha256 } from './accounts.js';

const TITLE_MAX = 100;
const TAGS_MAX = 100;
const BODY_MAX = 100000;
const LIST_MAX = 1000;
const DRAFTS_MAX = 20;
const BUBBLES_MAX = 30;
const CELLS_MAX = 5000;
const DAY = 86400000;
const BEIJING = 8 * 3600000; // 「一天」按北京时间算
// 版权声明：不声明、原创转载请注明出处、原创未经同意请勿转载
const RIGHTS = ['', 'credit', 'ask'];
const NEWEST_FIRST = 'ORDER BY p.date DESC, p.id DESC';
export const OWNER_NAME = '园主'; // 开放之前的文章显示的作者，昵称不能用它
const SUMMARY = `p.id, p.title, p.tags, p.date, p.draft, substr(p.body, 1, 300) AS head,
  COALESCE(u.name, '${OWNER_NAME}') AS author`;
const MINE = `${SUMMARY}, p.author_id, p.rights, p.hidden`;
const WITH_AUTHOR = 'FROM posts p LEFT JOIN users u ON u.id = p.author_id';
const VISIBLE = 'p.draft = 0 AND p.hidden = 0';
const HAS_POST = `EXISTS (SELECT 1 FROM posts p WHERE p.author_id = l.user_id AND ${VISIBLE})`;

export async function isAdmin(env, user) {
  return !!(user && user.email && env.LIFE_ADMIN_EMAIL_HASH
    && await sha256(user.email) === env.LIFE_ADMIN_EMAIL_HASH);
}

function beijingDate(offsetDays = 0) {
  return new Date(Date.now() + BEIJING + offsetDays * DAY).toISOString().slice(0, 10);
}

export function validDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

// 自己写的。开放之前的文章没有作者，算园主的
function ownPost(post, user, admin) {
  return !!user && (post.author_id === user.id || (admin && post.author_id === null));
}

function isPrivate(post) {
  return !!(post.draft || post.hidden);
}

function canEdit(post, user, admin) {
  return ownPost(post, user, admin) || (admin && !isPrivate(post));
}

async function publicList(env, author) {
  const where = !author ? '' : author === OWNER_NAME ? 'AND p.author_id IS NULL' : 'AND u.name = ?';
  const { results } = await env.DB.prepare(`SELECT ${SUMMARY} ${WITH_AUTHOR} WHERE ${VISIBLE} ${where} ${NEWEST_FIRST} LIMIT ?`)
    .bind(...(where.endsWith('?') ? [author] : []), LIST_MAX).all();
  return { list: results };
}

async function mine(env, user, admin) {
  const [posts, spent, place] = await Promise.all([
    env.DB.prepare(
      `SELECT ${MINE} ${WITH_AUTHOR} WHERE p.author_id = ?${admin ? ' OR p.author_id IS NULL' : ''} ${NEWEST_FIRST} LIMIT ?`
    ).bind(user.id, LIST_MAX).all(),
    env.DB.prepare('SELECT 1 FROM life_days WHERE user_id = ? AND day = ?').bind(user.id, beijingDate()).first(),
    env.DB.prepare('SELECT 1 FROM life_places WHERE user_id = ?').bind(user.id).first(),
  ]);
  // 发布过文章却不在地图上，说明作者取消过，页面上不要替他勾回来
  const published = posts.results.some(post => !isPrivate(post) && post.author_id === user.id);
  return { name: user.name, list: posts.results, wroteToday: !!spent, placeOff: published && !place };
}

async function read(env, id, user, admin) {
  const post = await env.DB.prepare(
    `SELECT p.id, p.title, p.body, p.tags, p.date, p.draft, p.counted, p.author_id, p.rights, p.hidden,
       COALESCE(u.name, '${OWNER_NAME}') AS author ${WITH_AUTHOR} WHERE p.id = ?`
  ).bind(id).first();
  if (!post || (isPrivate(post) && !ownPost(post, user, admin))) throw new ApiError(404, '这篇文章不存在');
  // 上一篇、下一篇都是同一位作者的
  const neighbour = (op, order) => env.DB.prepare(
    `SELECT id, title FROM posts p WHERE ${VISIBLE} AND author_id IS ? AND (date ${op} ? OR (date = ? AND id ${op} ?))
     ORDER BY date ${order}, id ${order} LIMIT 1`
  ).bind(post.author_id, post.date, post.date, post.id).first();
  const [newer, older] = await Promise.all([neighbour('>', 'ASC'), neighbour('<', 'DESC')]);
  const editable = canEdit(post, user, admin);
  delete post.author_id;
  return { post: { ...post, canEdit: editable }, newer, older };
}

// 坐标来自 Cloudflare 按网络判断的位置，取整到半度再保存
async function updatePlace(env, user, wanted, cf) {
  if (wanted === false) {
    await env.DB.prepare('DELETE FROM life_places WHERE user_id = ?').bind(user.id).run();
    return;
  }
  const lat = Number(cf && cf.latitude), lon = Number(cf && cf.longitude);
  const country = String((cf && cf.country) || '');
  if (wanted !== true || !cf || !cf.latitude || !cf.longitude || !Number.isFinite(lat + lon)) return;
  if (!/^[A-Z]{2}$/.test(country)) return;
  await env.DB.prepare(
    `INSERT INTO life_places (user_id, lat, lon, country, updated_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (user_id) DO UPDATE SET lat = excluded.lat, lon = excluded.lon,
       country = excluded.country, updated_at = excluded.updated_at`
  ).bind(user.id, Math.round(lat * 2) / 2, Math.round(lon * 2) / 2, country, Date.now()).run();
}

async function save(env, body, user, admin, cf) {
  const title = String(body.title || '').trim();
  const text = String(body.body || '').trim();
  const tags = String(body.tags || '').trim();
  const date = String(body.date || '');
  const draft = body.draft ? 1 : 0;
  if (!title || title.length > TITLE_MAX) throw new ApiError(400, `标题要 1 到 ${TITLE_MAX} 个字`);
  if (!text || text.length > BODY_MAX) throw new ApiError(400, '正文不能为空，也不能超过 10 万字');
  if (tags.length > TAGS_MAX) throw new ApiError(400, '标签太长了');
  if (!validDate(date)) throw new ApiError(400, '日期不对');
  if (body.rights !== undefined && !RIGHTS.includes(body.rights)) throw new ApiError(400, '版权声明不对');
  // 列表按日期排，写成将来的日期就能一直排在最前面
  if (date > beijingDate(1)) throw new ApiError(400, '日期不能是将来');

  const old = body.id
    ? await env.DB.prepare('SELECT id, author_id, draft, counted, rights, hidden FROM posts WHERE id = ?').bind(body.id).first()
    : null;
  if (body.id && (!old || (isPrivate(old) && !ownPost(old, user, admin)))) throw new ApiError(404, '这篇文章不存在');
  if (old && !canEdit(old, user, admin)) throw new ApiError(403, '这篇文章不是你写的');

  if (!old && draft) {
    const { n } = await env.DB.prepare('SELECT COUNT(*) AS n FROM posts WHERE author_id = ? AND draft = 1').bind(user.id).first();
    if (n >= DRAFTS_MAX) throw new ApiError(400, `草稿最多存 ${DRAFTS_MAX} 篇，先发布或删掉一些`);
  }

  const counted = old ? old.counted : 0;
  if (!draft && !counted) {
    const spent = await env.DB.prepare('INSERT OR IGNORE INTO life_days (user_id, day) VALUES (?, ?) RETURNING day')
      .bind(user.id, beijingDate()).first();
    if (!spent) throw new ApiError(429, '今天已经发布过一篇了，可以先存为草稿，明天再发布');
  }
  const nowCounted = draft ? counted : 1;
  // 没带这两项的旧页面沿用原来的；园主改别人的文章时，声明和公开与否也保持作者的选择
  const keep = old && (!ownPost(old, user, admin));
  const rights = keep || body.rights === undefined ? (old ? old.rights : '') : body.rights;
  const hidden = keep || body.public === undefined ? (old ? old.hidden : 0) : body.public ? 0 : 1;

  const now = Date.now();
  const row = old
    ? await env.DB.prepare(
      'UPDATE posts SET title = ?, body = ?, tags = ?, date = ?, draft = ?, counted = ?, rights = ?, hidden = ?, updated_at = ? WHERE id = ? RETURNING id'
    ).bind(title, text, tags, date, draft, nowCounted, rights, hidden, now, old.id).first()
    : await env.DB.prepare(
      `INSERT INTO posts (title, body, tags, date, draft, counted, rights, hidden, author_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`
    ).bind(title, text, tags, date, draft, nowCounted, rights, hidden, user.id, now, now).first();

  // 不公开的文章不碰地图上的位置
  if (!draft && !hidden && (!old || ownPost(old, user, admin))) await updatePlace(env, user, body.place, cf);
  return { id: row.id, counted: nowCounted };
}

async function remove(env, id, user, admin) {
  const post = await env.DB.prepare('SELECT author_id, draft, hidden FROM posts WHERE id = ?').bind(id).first();
  if (!post) return { ok: true };
  if (!canEdit(post, user, admin)) throw new ApiError(403, '这篇文章不是你写的');
  await env.DB.prepare('DELETE FROM posts WHERE id = ?').bind(id).run();
  return { ok: true };
}

// 只算至少有一篇公开文章的作者。每位作者只算一次，住得近的合在同一个格子里
async function map(env) {
  const [cells, bubbles] = await Promise.all([
    env.DB.prepare(
      `SELECT l.lat, l.lon, MIN(l.country) AS country, COUNT(*) AS authors FROM life_places l
       WHERE ${HAS_POST} GROUP BY l.lat, l.lon LIMIT ?`
    ).bind(CELLS_MAX).all(),
    env.DB.prepare(
      `SELECT u.name AS author, l.lat, l.lon, l.country, p.id, p.title FROM life_places l
       JOIN users u ON u.id = l.user_id
       JOIN posts p ON p.id = (SELECT id FROM posts p WHERE author_id = l.user_id AND ${VISIBLE}
                               ORDER BY date DESC, id DESC LIMIT 1)
       ORDER BY RANDOM() LIMIT ?`
    ).bind(BUBBLES_MAX).all(),
  ]);
  return { cells: cells.results, bubbles: bubbles.results };
}

export async function lifeRoute(env, key, url, body, user, cf) {
  const admin = await isAdmin(env, user);
  const needWriter = () => {
    if (!user) throw new ApiError(401, '请先登录');
    // 游客账号不用验证就能批量生成，每天一篇的限制对它没有意义
    if (!user.email) throw new ApiError(403, '游客账号不能写文章，请用邮箱或 Google 登录');
  };
  switch (key) {
    case 'GET /api/life/posts':
      return publicList(env, url.searchParams.get('author'));
    case 'GET /api/life/post':
      return read(env, Number(url.searchParams.get('id')), user, admin);
    case 'GET /api/life/map':
      return map(env);
    case 'GET /api/life/mine':
      needWriter();
      return mine(env, user, admin);
    case 'POST /api/life/save':
      needWriter();
      return save(env, body, user, admin, cf);
    case 'POST /api/life/delete':
      needWriter();
      return remove(env, body.id, user, admin);
  }
  throw new ApiError(404, '接口不存在');
}
