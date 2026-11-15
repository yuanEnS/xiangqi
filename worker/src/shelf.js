// 研究园的书架：收藏（打星）、阅读状态（想读 / 在读 / 读完）、一两句笔记。数据只有自己看得到。
//   GET  /api/shelf                书架上的全部条目
//   POST /api/shelf/save {item, title, journal?, date?, link?, starred?, status?, note?}
//        只改传了的字段；星、状态、笔记都空了就从书架上拿掉
//   POST /api/shelf/remove {item}
// 要用邮箱或 Google 登录的正式账号（游客账号换个浏览器就找不回来了）。
import { ApiError, overLimit } from './accounts.js';

const MAX_ITEMS = 5000;
const NOTE_MAX = 300;
const STATUSES = ['want', 'reading', 'done'];

function text(value, max, label) {
  const out = String(value ?? '').replace(/\s+/g, ' ').trim();
  if ([...out].length > max) throw new ApiError(400, `${label}太长了`);
  return out;
}

function member(user) {
  if (!user) throw new ApiError(401, '请先登录');
  if (!user.email) throw new ApiError(403, '游客账号不能用书架，请用邮箱或 Google 登录');
  return user;
}

async function list(env, user) {
  const { results } = await env.DB.prepare(
    'SELECT item, title, journal, date, link, starred, status, note, done_at, updated_at FROM shelf WHERE user_id = ? ORDER BY updated_at DESC'
  ).bind(user.id).all();
  return { items: results.map(r => ({ ...r, starred: !!r.starred })) };
}

async function save(env, body, user) {
  if (await overLimit(env, `shelf:${user.id}`, 120, 60000)) throw new ApiError(429, '操作太快了，歇一会儿再试');
  const item = text(body.item, 200, '编号');
  if (!item) throw new ApiError(400, '缺少文章编号');
  const old = await env.DB.prepare('SELECT * FROM shelf WHERE user_id = ? AND item = ?').bind(user.id, item).first();
  const now = Date.now();
  const row = old ? { ...old } : { title: '', journal: '', date: '', link: '', starred: 0, status: null, note: '', done_at: null };
  // 标题这些描述信息每次都可以更新（文章信息改了以后书架上也跟着改）
  if (body.title !== undefined) row.title = text(body.title, 400, '标题');
  if (body.journal !== undefined) row.journal = text(body.journal, 40, '期刊名');
  if (body.date !== undefined) row.date = text(body.date, 10, '日期');
  if (body.link !== undefined) {
    const link = text(body.link, 500, '链接');
    if (link && !/^(https?:\/\/|\/)/.test(link)) throw new ApiError(400, '链接不对');
    row.link = link;
  }
  if (!row.title) throw new ApiError(400, '缺少标题');
  if (body.starred !== undefined) row.starred = body.starred ? 1 : 0;
  if (body.status !== undefined) {
    const status = body.status || null;
    if (status && !STATUSES.includes(status)) throw new ApiError(400, '阅读状态不对');
    if (status === 'done' && row.status !== 'done') row.done_at = now;
    if (status !== 'done') row.done_at = null;
    row.status = status;
  }
  if (body.note !== undefined) {
    const note = String(body.note ?? '').replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    if ([...note].length > NOTE_MAX) throw new ApiError(400, `笔记最多 ${NOTE_MAX} 个字`);
    row.note = note;
  }
  if (!row.starred && !row.status && !row.note) {
    await env.DB.prepare('DELETE FROM shelf WHERE user_id = ? AND item = ?').bind(user.id, item).run();
    return { item, removed: true };
  }
  if (!old) {
    const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM shelf WHERE user_id = ?').bind(user.id).first();
    if (count.n >= MAX_ITEMS) throw new ApiError(400, `书架最多放 ${MAX_ITEMS} 篇`);
  }
  await env.DB.prepare(
    `INSERT INTO shelf (user_id, item, title, journal, date, link, starred, status, note, done_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (user_id, item) DO UPDATE SET title = excluded.title, journal = excluded.journal, date = excluded.date,
       link = excluded.link, starred = excluded.starred, status = excluded.status, note = excluded.note,
       done_at = excluded.done_at, updated_at = excluded.updated_at`
  ).bind(user.id, item, row.title, row.journal, row.date, row.link, row.starred, row.status, row.note, row.done_at, now).run();
  return { item: { item, title: row.title, journal: row.journal, date: row.date, link: row.link, starred: !!row.starred,
    status: row.status, note: row.note, done_at: row.done_at, updated_at: now } };
}

export async function shelfRoute(env, key, body, user) {
  member(user);
  switch (key) {
    case 'GET /api/shelf':
      return list(env, user);
    case 'POST /api/shelf/save':
      return save(env, body, user);
    case 'POST /api/shelf/remove':
      await env.DB.prepare('DELETE FROM shelf WHERE user_id = ? AND item = ?').bind(user.id, text(body.item, 200, '编号')).run();
      return { ok: true };
  }
  throw new ApiError(404, '接口不存在');
}
